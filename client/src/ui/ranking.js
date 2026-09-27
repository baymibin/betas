import {raceAvatarSvg} from '../characters/stick-avatar.js';
export function raceOrder(players){return [...players].sort((a,b)=>{if(a.place||b.place)return (a.place||99)-(b.place||99);return a.z-b.z||a.id-b.id;});}
export function createRanking(){const root=document.createElement('ol');root.id='race-ranking';root.setAttribute('aria-label','Posiciones de carrera');root.hidden=true;document.body.append(root);let signature='',checkedAt=-1e9;
 return {hide(){root.hidden=true;signature='';},update(players,ownId){root.hidden=false;
  // Como mucho 5 comprobaciones por segundo: con bots el orden cambia a menudo y rehacer la lista (SVG) cada frame da tirones.
  const now=performance.now();if(signature&&now-checkedAt<200)return;checkedAt=now;
  const sorted=raceOrder(players),key=JSON.stringify(sorted.map(p=>[p.id,p.character,p.board,p.bot|0,ownId===p.id]));if(key===signature)return;signature=key;root.replaceChildren();sorted.forEach((p,i)=>{const li=document.createElement('li');li.classList.toggle('is-you',p.id===ownId);li.classList.toggle('is-bot',!!p.bot);li.setAttribute('aria-label',`${i+1}. ${p.nick||'Surfer'}${p.id===ownId?' (tú)':p.bot?' (IA)':''}`);li.title=p.nick||'Surfer';li.innerHTML=`<b>${i+1}</b>`+raceAvatarSvg(p.character||0,p.board||0);root.append(li);});}};
}
