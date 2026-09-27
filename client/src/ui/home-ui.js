import {profile,characters,boards,wings} from './shop.js';
import {previewSvg} from '../characters/stick-avatar.js';
import {settings, saveSettings, VOLUME_FIELDS} from '../core/settings.js';
import {playSound, startMatchAudio, stopMatchAudio, updateAudioVolumes} from '../audio/audio.js';
export {settings, playSound, startMatchAudio, stopMatchAudio, updateAudioVolumes};

document.addEventListener('click', e => { if (e.target.closest('button')) playSound(); });
const settingsDialog=document.getElementById('settings-dialog'),profileDialog=document.getElementById('profile-dialog');
for(const dialog of [settingsDialog,profileDialog])dialog.querySelector('.dialog-close').onclick=()=>dialog.close();
document.getElementById('home-settings').onclick=()=>settingsDialog.showModal();
document.getElementById('home-battle').onclick=()=>document.getElementById('nickname').focus();
document.querySelector('.home-brand').onclick=e=>{e.preventDefault();document.getElementById('nickname').focus();};
document.getElementById('home-rooms').onclick=()=>document.dispatchEvent(new Event('surf:rooms'));
document.getElementById('home-profile').onclick=()=>{
 document.getElementById('profile-preview').innerHTML=previewSvg(profile.character,profile.board);
 document.getElementById('profile-name').textContent=profile.nick||'Surfer';
 document.getElementById('profile-style').textContent=characters[profile.character]+' · '+boards[profile.board]+(wings[profile.wing]?' · '+wings[profile.wing]+' Wings':'');profileDialog.showModal();
};
document.getElementById('profile-customize').onclick=()=>{profileDialog.close();document.getElementById('shop-btn').click();};
function apply(){document.body.classList.toggle('effects-off',!settings.effects);document.dispatchEvent(new CustomEvent('surf:settings',{detail:settings}));}
// Sliders de volumen: muestran el % y la parte rellena; el cambio suena al instante.
function paintVolume(field){const input=document.getElementById('setting-'+field),out=document.getElementById('setting-'+field+'-value');if(!input)return;input.style.setProperty('--fill',settings[field]+'%');if(out)out.textContent=settings[field]+' %';input.closest('.volume-row')?.classList.toggle('is-muted',!settings[field]||!settings.sound);}
for(const field of ['sound',...VOLUME_FIELDS,'effects','quality']){
 const input=document.getElementById('setting-'+field);if(!input)continue;if(input.type==='checkbox')input.checked=settings[field];else input.value=settings[field];
 if(VOLUME_FIELDS.includes(field))paintVolume(field);
 input.addEventListener('input',()=>{settings[field]=input.type==='checkbox'?input.checked:VOLUME_FIELDS.includes(field)?Number(input.value):input.value;saveSettings();apply();updateAudioVolumes();VOLUME_FIELDS.forEach(paintVolume);document.getElementById('settings-saved').textContent='Preferencias guardadas';});
}
// Al soltar el slider de efectos se escucha una muestra con el nuevo volumen.
document.getElementById('setting-sfx')?.addEventListener('change',()=>playSound('impact'));
apply();
