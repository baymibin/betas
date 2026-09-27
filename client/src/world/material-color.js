// Keep the appearance color independent from animated emission.
export function setGlow(material,strength) {
  const base=material.diffuseColor;
  if(material.emissiveColor===base) material.emissiveColor=base.clone();
  material.emissiveColor.copyFrom(base).scaleInPlace(strength);
}
