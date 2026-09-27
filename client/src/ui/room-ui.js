import {MAPS} from '../shared/maps.js';
import {read,readRoomList} from '../shared/protocol.js';
export function createRoomUI(net,profile,onRace){
 const root=document.createElement('section');root.id='room-dialog';root.hidden=true;
 const style=document.createElement('style');style.textContent=`#room-dialog{position:fixed;inset:0;z-index:70;background:#062e3bd9;display:grid;place-items:center;font-family:sans-serif;color:#fff}#room-dialog[hidden]{display:none}#room-dialog article{padding:28px;width:min(450px,87vw);max-height:85vh;overflow:auto;background:#164c5a;border:1px solid #ffffff40;border-radius:24px}#room-dialog h2{margin:0 0 20px}#room-dialog label{display:block;font-size:13px;margin:14px 0 8px}#room-dialog input,#room-dialog select{width:100%;box-sizing:border-box;background:#0c3743;border:1px solid #ffffff50;padding:12px;border-radius:10px;color:white;font:inherit}#room-dialog button{padding:13px;border:0;border-radius:10px;cursor:pointer;font:600 14px sans-serif;margin-top:12px;width:100%;background:#ffd184;color:#123b46}#room-dialog .secondary{background:#ffffff15;color:white}#room-code{font-size:36px;letter-spacing:5px;color:#ffdf98;margin:14px 0}#room-roster{padding-left:22px;line-height:1.9}#room-error{color:#ffb9a3;line-height:1.4}`;document.head.append(style);document.body.append(root);
 let began=false,roster=[],busy=false,signature='';
 let directory=null,heartbeat=null;
 function stopDirectory(){clearInterval(heartbeat);const ws=directory;directory=null;ws?.close();}
 function showDirectory(){
  stopDirectory();const article=root.querySelector('article'),section=document.createElement('section');
  section.innerHTML='<h3>Salas disponibles</h3><div id="available-rooms" aria-live="polite">Buscando salas...</div>';article.insertBefore(section,article.querySelector('label'));
  const ws=directory=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/lobby`);ws.binaryType='arraybuffer';
  ws.onopen=()=>{heartbeat=setInterval(()=>{if(ws.readyState===1)ws.send(new ArrayBuffer(0));},25000);};
  ws.onmessage=({data})=>{if(directory!==ws)return;const list=readRoomList(read(data)),box=section.querySelector('div');box.replaceChildren();if(!list.length){box.textContent='No hay salas abiertas. Crea la primera!';return;}for(const room of list){const button=document.createElement('button');button.className='secondary';button.textContent=`${room.host}  -  ${MAPS[room.mapId].name}  -  ${room.count}/8 - Entrar`;button.disabled=busy;button.onclick=()=>connect({mode:2,code:room.code});box.append(button);}};
  ws.onclose=()=>{if(directory===ws)section.querySelector('div').textContent='No se pudo cargar el lobby. Vuelve a abrirlo para reintentar.';};
 }
 const form=()=>{signature='';root.innerHTML='<article><h2>Jugar con amigos</h2><p>Quien crea la sala elige el mapa y da la salida.</p><label for="room-map">Mapa de la partida</label><select id="room-map">'+MAPS.map(m=>'<option value="'+m.id+'">'+m.name+' - Dificultad '+m.difficulty+'/8</option>').join('')+'</select><button id="room-create">Crear partida</button><label for="room-join-code">O unete con un codigo</label><input id="room-join-code" maxlength="6" inputmode="numeric" placeholder="Codigo de 6 numeros"><button id="room-join" class="secondary">Unirse a la partida</button><p id="room-error" role="alert"></p><button id="room-cancel" class="secondary">Volver</button></article>';root.querySelector('#room-create').onclick=()=>connect({mode:1,mapId:Number(root.querySelector('#room-map').value)});root.querySelector('#room-join').onclick=()=>{const code=root.querySelector('input').value.trim();if(!/^\d{6}$/.test(code)){root.querySelector('#room-error').textContent='Escribe los 6 numeros del codigo.';return;}connect({mode:2,code});};root.querySelector('#room-cancel').onclick=()=>{root.hidden=true;stopDirectory();net.close();};showDirectory();};
 async function connect(options){if(busy)return;busy=true;stopDirectory();root.querySelectorAll('button').forEach(b=>b.disabled=true);try{await net.connect(profile,options);render(net.room,roster);}catch(e){form();root.querySelector('#room-error').textContent=e.message;}finally{busy=false;}}
 function render(room,list){
  if(!room||root.hidden)return;if(list.length)roster=list;
  if(room.started){if(!began&&net.player){began=true;root.hidden=true;onRace();}return;}
  const key=JSON.stringify([room,roster.map(p=>[p.id,p.nick])]);if(key===signature)return;signature=key;
  const host=room.hostId===net.id;
  root.innerHTML='<article><h2>Sala de espera</h2><p>Comparte este codigo</p><div id="room-code"></div><p id="room-map-name"></p><ol id="room-roster"></ol><p id="room-wait"></p><button id="room-launch">Iniciar carrera</button><button id="room-leave" class="secondary">Salir de la sala</button></article>';
  root.querySelector('#room-code').textContent=room.code;root.querySelector('#room-map-name').textContent=MAPS[room.mapId].name+' - Dificultad '+MAPS[room.mapId].difficulty+'/8';
  const ol=root.querySelector('ol');for(const p of roster){const li=document.createElement('li');li.textContent=p.nick+(p.id===room.hostId?' (anfitrion)':'');ol.append(li);}
  root.querySelector('#room-wait').textContent=host?'Cuando esten todos, inicia la cuenta regresiva.': 'Esperando a que el anfitrion inicie la carrera.';
  const launch=root.querySelector('#room-launch');launch.hidden=!host;launch.onclick=()=>net.startRoom();root.querySelector('#room-leave').onclick=()=>{net.close();form();};
 }
 net.onRoom=render;
 return {open(){net.close();began=false;roster=[];root.hidden=false;form();}};
}
