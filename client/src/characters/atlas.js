let pending;
// Load the catalog only when the shop is opened. Reuse the decoded image afterwards.
export function loadAtlas() {
  if(!pending) pending=new Promise((resolve,reject)=>{
    const image=new Image();image.onload=()=>{
      const url='/assets/images/sprites/surf-atlas.png';
      document.documentElement.style.setProperty('--surf-atlas',`url("${url}")`);resolve(url);
    };image.onerror=()=>{pending=null;reject(Error('No se pudieron cargar los sprites. Intenta de nuevo.'));};image.src='/assets/images/sprites/surf-atlas.png';
  });return pending;
}
