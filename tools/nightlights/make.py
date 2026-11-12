import sys, numpy as np
from PIL import Image
d=sys.argv[1]; out=sys.argv[2]
q=lambda n: np.asarray(Image.open(f"{d}/q_{n}.png").convert('RGB')).astype(np.float32)
top=np.concatenate([q('0_-180_90_0'),q('0_0_90_180')],axis=1)
bot=np.concatenate([q('-90_-180_0_0'),q('-90_0_0_180')],axis=1)
a=np.concatenate([top,bot],axis=0)   # 3600 x 7200 x 3
R,G,B=a[...,0],a[...,1],a[...,2]
# lights: yellow/white, base land/sea is dark blue-gray -> remove blue-tinted base
Y=0.3*R+0.59*G+0.11*B
# base land/sea is dark blue-gray (Y<~15); image is display-encoded -> linearize after removing base
L=np.clip((Y-15)/240,0,1)**2.2
# box average 2x2 -> 0.1 deg
L=L.reshape(1800,2,3600,2).mean(axis=(1,3))
print('max',L.max(),'mean',L.mean(),'p99.9',np.percentile(L,99.9),'nonzero frac',(L>1).mean())
v=np.clip(np.sqrt(L/L.max())*255,0,255).astype(np.uint8)
Image.fromarray(v,'L').save(out, optimize=True)
