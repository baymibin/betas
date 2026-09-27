import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setGlow} from '../../client/src/world/material-color.js';
class Color {
 constructor(r,g,b){Object.assign(this,{r,g,b});}
 clone(){return new Color(this.r,this.g,this.b);}
 copyFrom(c){Object.assign(this,c);return this;}
 scaleInPlace(v){this.r*=v;this.g*=v;this.b*=v;return this;}
}
test('glow never accumulates into selected color, including aliased materials',()=>{
 const color=new Color(.3,.8,.6),material={diffuseColor:color,emissiveColor:color};
 for(let i=0;i<10000;i++)setGlow(material,i%2?1.3:2);
 assert.deepEqual(color,new Color(.3,.8,.6));
 setGlow(material,1);assert.deepEqual(material.emissiveColor,color);assert.notEqual(material.emissiveColor,color);
});
