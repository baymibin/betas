import {RemoteTimeline} from './remote-timeline.js';
import {TYPE,readPowerWorld,read,input,states,profilePacket,roomRequest,readRoom,packet,roomBots,PROTOCOL_VERSION} from '../shared/protocol.js';
import {advance,DT} from '../shared/simulation.js';
export class SurfNetwork {
  constructor(status) { this.status=status; this.pending=[]; this.remote=[]; this.buttons=0; this.axis=0; this.seq=0; this.errorX=0; this.errorZ=0; }
  connect(profile,options={mode:1,mapId:0}) {
    this.close();this.room=null;this.options=options;this.powerWorld={taken:new Set(),entities:[]};this.timeline=new RemoteTimeline();
    this.pending=[]; this.remote=[]; this.seq=0; this.buttons=0; this.player=null;this.authoritative=null;this.errorX=0;this.errorZ=0;
    return new Promise((resolve,reject) => {
      const ws=this.ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/play`);
      ws.binaryType='arraybuffer';
      const timeout=setTimeout(()=>{ ws.close(); reject(Error('El servidor no responde')); },5000);
      ws.onmessage=({data})=>{
        if(this.ws!==ws) return;
        try {
          const v=read(data), type=v.getUint8(1);
          if(type===TYPE.WELCOME) { this.id=v.getUint32(12,true);
            // Servidor anterior (sin byte de versión): perfil de 47 bytes para que la sala se cree igual.
            this.serverVersion=v.byteLength<17?1:v.getUint8(16);
            this.legacyServer=this.serverVersion<2;
            if(this.legacyServer)console.warn('[surf] el servidor usa el protocolo anterior: reinícialo para sincronizar las wings entre jugadores.');
            ws.send(profilePacket(profile,this.legacyServer));ws.send(roomRequest(options.mode,options.mapId||0,options.code||'',options.capacity||8,this.supportsBots&&options.mode===1?(options.bots|0):null)); return; }
          if(type===TYPE.ROOM_STATE){this.room=readRoom(v);this.onRoom?.(this.room,[]);return;}
          if(type===TYPE.ERROR){clearTimeout(timeout);reject(Error(v.byteLength>12&&v.getUint8(12)===2?'Este circuito estará disponible próximamente.':'Sala no disponible: revisa el codigo, puede estar llena o haber comenzado.'));this.close();return;}
          if(type===TYPE.POWER_WORLD){this.powerWorld=readPowerWorld(v);return;}
          if(type!==TYPE.SNAPSHOT) return;
          const list=states(v), own=list.find(p=>p.id===this.id);
          if(!own) return;
          this.pending=this.pending.filter(c=>c.seq>own.seq);
          const before=this.player;
          this.players=list;this.authoritative={...own};this.player={...own};
          for(const c of this.pending) advance(this.player,c.axis,c.buttons);
          // Corrección del servidor (poderes que el cliente no predice, p. ej. el pulso de un bot):
          // se guarda como error visual que se disipa en unos 150 ms en vez de teletransportar.
          if(before){this.errorX+=before.x-this.player.x;this.errorZ+=before.z-this.player.z;
            if(Math.hypot(this.errorX,this.errorZ)>8){this.errorX=0;this.errorZ=0;}}
          this.timeline.push(v.getUint32(8,true),list.filter(p=>p.id!==this.id),performance.now());this.remote=this.timeline.frames;
          this.onRoom?.(this.room,list);
          this.status(`ONLINE  -  ${list.length}/${this.room?.capacity||8} SURFISTAS`);
          if(!this.timer) { clearTimeout(timeout); this.timer=setInterval(()=>this.update(),DT*1000); resolve(); }
        } catch { ws.close(); }
      };
      ws.onerror=()=>reject(Error('No se pudo conectar al servidor'));
      ws.onclose=()=>{ clearTimeout(timeout); if(this.ws===ws) {clearInterval(this.timer); this.timer=null; this.player=null; this.status('DESCONECTADO  -  vuelve a Practica o recarga para conectar');} reject(Error(this.room?'Conexion cerrada':'El servidor cerró la conexión antes de crear la sala. Reinicia el servidor y vuelve a intentarlo.')); };
    });
  }
  update() {
    if(!this.player || this.ws.readyState!==1 || !this.room?.started) return;
    if(this.pending.length>=90 || this.ws.bufferedAmount>4096) { this.status('RECUPERANDO CONEXION...'); return; }
    const c={seq:++this.seq,axis:Math.round(this.axis*127)/127,buttons:this.buttons | (this.boostHeld?2:0) | (this.throttleHeld?8:0)}; this.buttons=0;
    this.pending.push(c); advance(this.player,c.axis,c.buttons); this.ws.send(input(c.seq,c.axis,c.buttons));
  }
  // Estado a dibujar: la predicción más el error de corrección pendiente, que decae con dt.
  view(dt){const k=Math.exp(-20*dt);this.errorX*=k;this.errorZ*=k;
    if(Math.abs(this.errorX)<1e-3&&Math.abs(this.errorZ)<1e-3){this.errorX=0;this.errorZ=0;return this.player;}
    return {...this.player,x:this.player.x+this.errorX,z:this.player.z+this.errorZ};}
  // Reenvía el perfil visual (skin, tabla, wings, hat) si el jugador cambia su equipamiento
  // estando conectado; el servidor lo propaga a todos en el siguiente SNAPSHOT.
  sendProfile(profile){if(this.ws?.readyState===1&&this.id!==undefined&&!this.legacyServer)this.ws.send(profilePacket(profile));}
  // Bots: el servidor (v3+) los crea, simula y equipa; aquí solo se pide la cantidad (anfitrión).
  get supportsBots(){return (this.serverVersion||0)>=3;}
  setBots(count){if(this.supportsBots&&this.ws?.readyState===1&&this.room?.hostId===this.id&&!this.room.started)this.ws.send(roomBots(Math.max(0,Math.min(7,count|0))));}
  startRoom(){if(this.room?.hostId===this.id)this.ws?.send(packet(TYPE.ROOM_START,12).buffer);}
  close() { const ws=this.ws;this.ws=null;clearInterval(this.timer);this.timer=null;this.player=null;ws?.close(); }
}
