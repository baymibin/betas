import {createRanking,raceOrder} from './ranking.js';
const escapeText=t=>String(t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
import {MAPS} from '../shared/maps.js';
export const TRICKS=['Aerial 360','Shove-it','Method grab','Superman','Tail grab'];
// Aviso temporal de vuelta completada (el contador permanente VUELTA x/3 sigue en el radar).
const LAP_CSS=`#lap-notice{position:fixed;top:74px;left:50%;z-index:61;transform:translate(-50%,-14px) scale(.96);opacity:0;pointer-events:none;
 min-width:min(360px,86vw);padding:12px 26px 14px;border-radius:20px;text-align:center;font-family:'Baloo 2',system-ui,sans-serif;color:#fff;
 background:linear-gradient(160deg,rgba(10,77,99,.94),rgba(4,34,50,.94));border:1.5px solid rgba(92,232,240,.75);
 box-shadow:0 14px 40px rgba(0,19,29,.55),0 0 22px rgba(47,214,228,.35),inset 0 0 0 1px rgba(255,255,255,.12);
 transition:opacity .35s ease,transform .45s cubic-bezier(.2,.9,.3,1.25)}
#lap-notice.show{opacity:1;transform:translate(-50%,0) scale(1)}
#lap-notice.hide{opacity:0;transform:translate(-50%,-10px) scale(.98);transition:opacity .45s ease,transform .45s ease}
#lap-notice small{display:block;font-size:13px;font-weight:800;letter-spacing:2.2px;color:#5ce8f0;line-height:1.2}
#lap-notice strong{display:block;margin-top:2px;font-size:32px;font-weight:800;line-height:1.05;letter-spacing:.5px;color:#ffd257;text-shadow:0 3px 12px rgba(0,27,36,.8),0 0 14px rgba(255,197,63,.35)}
#lap-notice.final strong{color:#ffe07a}
@media(max-width:600px){#lap-notice{top:198px;padding:9px 18px 11px}#lap-notice strong{font-size:24px}#lap-notice small{font-size:11px}}`;
export function createRaceUI(){const rank=createRanking();
 const style=document.createElement('style');style.textContent=`#race-info{position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:9;background:#123d49df;color:#fff;padding:10px 18px;border-radius:14px;text-align:center;font:600 13px sans-serif}#race-countdown{position:fixed;inset:0;display:grid;place-content:center;text-align:center;pointer-events:none;color:#ffdf83;text-shadow:0 4px 20px #103543;z-index:20;font:900 110px sans-serif}#race-results{position:fixed;inset:0;z-index:60;background:#082b38cc;display:grid;place-items:center;color:white;font-family:sans-serif}#race-results[hidden]{display:none}#race-results article{width:min(430px,85vw);background:#164c5a;padding:32px;border:1px solid #ffffff40;border-radius:25px;text-align:center}#race-results .stats{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:22px 0}#race-results .stats div{padding:14px;background:#ffffff10;border-radius:12px}#race-results strong{display:block;font-size:27px;color:#ffe29a}#race-results .race-standings{list-style:none;margin:0 0 16px;padding:0;display:grid;gap:4px;text-align:left;max-height:34vh;overflow:auto}#race-results .race-standings li{display:grid;grid-template-columns:34px 1fr auto;align-items:center;padding:6px 10px;border-radius:10px;background:#ffffff0d;font:600 14px 'Baloo 2',sans-serif}#race-results .race-standings li.is-you{background:#ffd2571f;outline:1px solid #ffd25780}#race-results .race-standings b{color:#ffe29a}#race-results .race-standings i{font-style:normal;font-size:10px;font-weight:800;letter-spacing:1px;color:#073745;background:#5ce8f0;border-radius:6px;padding:1px 5px;margin-left:4px;vertical-align:1px}#race-results .race-standings small{color:#a8d8df}#race-results button{padding:14px 22px;border:0;border-radius:12px;background:#ffcd78;color:#123b46;font-weight:bold;cursor:pointer}@media(max-width:600px){#race-info{top:154px;font-size:11px}}`;document.head.append(style);
 const lapStyle=document.createElement('style');lapStyle.textContent=LAP_CSS;document.head.append(lapStyle);
 const lapNotice=document.createElement('div');lapNotice.id='lap-notice';lapNotice.setAttribute('role','status');lapNotice.setAttribute('aria-live','polite');document.body.append(lapNotice);let lapTimers=[];
 const clearLap=()=>{lapTimers.forEach(clearTimeout);lapTimers=[];lapNotice.className='';};
 const info=document.createElement('div');info.id='race-info';document.body.append(info);
 const clock=document.createElement('div');clock.id='race-clock';clock.style.cssText='position:fixed;left:18px;top:146px;z-index:9;color:white;background:#123d49df;padding:8px 12px;border-radius:10px;font:600 13px sans-serif';document.body.append(clock);
 const count=document.createElement('div');count.id='race-countdown';document.body.append(count);
 const result=document.createElement('section');result.id='race-results';result.hidden=true;document.body.append(result);
 return {ranking(players,ownId){rank.update(players,ownId);},start(id){result.hidden=true;const m=MAPS[id];info.textContent=m.name+' \u00b7 Dificultad '+m.difficulty+'/8 \u00b7 3 vueltas';},update(p){clock.textContent='Tiempo '+(p.raceTicks/30).toFixed(1)+' s | Rampas '+p.ramps;count.textContent=p.countdown>0?Math.ceil(p.countdown/30):p.raceTicks<18?'\u00a1YA!':'';},lapComplete(done,total){
  // done = vueltas completadas y confirmadas; total = vueltas de la carrera.
  clearLap();
  const finished=done>=total,next=done+1;
  lapNotice.innerHTML=finished?'<small>VUELTA '+done+' COMPLETADA</small><strong>\u00a1CARRERA COMPLETADA!</strong>'
   :'<small>VUELTA '+done+' COMPLETADA</small><strong>'+(next===total?'VUELTA FINAL '+next+'/'+total:'VUELTA '+next+'/'+total)+'</strong>';
  void lapNotice.offsetWidth;lapNotice.className='show'+(next===total&&!finished?' final':'');
  lapTimers.push(setTimeout(()=>{lapNotice.className='hide'+(next===total&&!finished?' final':'');},2500));
  lapTimers.push(setTimeout(clearLap,3000));
 },hide(){clearLap();rank.hide();count.textContent='';result.hidden=true;},finish(p,ranked,standings=[]){count.textContent='';const time=p.raceTicks/30,fmt=t=>Math.floor(t/60)+':'+(t%60).toFixed(2).padStart(5,'0');
  // Clasificación final: humanos y bots (IA) con su puesto real; los que siguen en carrera, al final.
  const table=standings.length>1?'<ol class="race-standings">'+raceOrder(standings).map(q=>'<li class="'+(q.id===p.id?'is-you':'')+'"><b>'+(q.place?q.place+'\u00ba':'\u2014')+'</b><span>'+escapeText(q.nick||'Surfer')+(q.bot?' <i>IA</i>':'')+'</span><small>'+(q.place?fmt(q.raceTicks/30):'en carrera')+'</small></li>').join('')+'</ol>':'';
  result.innerHTML='<article><small>CARRERA COMPLETADA</small><h1>'+MAPS[p.mapId].name+'</h1><div class="stats"><div><strong>'+fmt(time)+'</strong>Tiempo</div><div><strong>'+(ranked&&p.place?p.place+'\u00ba':'1\u00ba')+'</strong>'+(ranked?'Puesto de llegada':'Practica individual')+'</div><div><strong>'+p.ramps+'</strong>Rampas completadas</div><div><strong>'+p.jumps+'</strong>Saltos con pirueta</div></div>'+table+'<p>3 de 3 vueltas</p><button>Volver al inicio</button></article>';result.hidden=false;result.querySelector('button').onclick=()=>{result.hidden=true;document.dispatchEvent(new Event('surf:menu'));};}};
}
