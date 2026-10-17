"""Generate original, periodic soundscapes and app icons. No external media."""
from pathlib import Path
import math, random, struct, wave, zlib

ROOT=Path(__file__).resolve().parents[1]
RATE=22050
SECONDS=16
N=RATE*SECONDS
random.seed(428)

def smooth_noise(n, rate):
    # Periodic interpolation: wraparound has the same continuity as every knot.
    knots=[random.uniform(-1,1) for _ in range(rate*SECONDS)]
    out=[]
    for i in range(n):
        p=i*len(knots)/n; j=int(p); f=p-j; f=f*f*(3-2*f)
        out.append(knots[j]*(1-f)+knots[(j+1)%len(knots)]*f)
    return out

white=[random.uniform(-1,1) for _ in range(N)]
low=smooth_noise(N,55); mid=smooth_noise(N,700); high=smooth_noise(N,5500)
def noise(kind,i,t):
    if kind=='white': return white[i]*.27
    if kind=='pink': return .28*low[i]+.2*mid[i]+.09*white[i]
    if kind=='brown': return .6*low[i]+.05*mid[i]
    if kind=='soft': return .35*mid[i]+.1*low[i]
    if kind=='rain': return (.23*high[i]+.14*white[i]+.1*mid[i])*(.85+.15*math.cos(2*math.pi*t/16))
    if kind=='ocean': return (.3*mid[i]+.33*low[i]+.07*high[i])*(.6+.4*math.sin(2*math.pi*t/8))
    if kind=='forest': return (.36*low[i]+.09*mid[i])*(.7+.3*math.cos(2*math.pi*t/16))
    if kind=='stream': return (.18*mid[i]+.13*high[i]+.12*math.sin(2*math.pi*(330*t+2*math.sin(2*math.pi*t/2))))*.7
    freqs={'warm':[110,165,220], 'chords':[130.8125,164.8125,196], 'air':[220,330,440], 'bells':[261.625,392,523.25]}[kind]
    value=0
    for j,f in enumerate(freqs):
        # Quantize frequency so the entire waveform repeats exactly every 16 s.
        f=round(f*SECONDS)/SECONDS
        env=(.65+.35*math.cos(2*math.pi*t/SECONDS+j))
        if kind=='bells':env=env**6
        value+=math.sin(2*math.pi*f*t)*env/(j+2)
    return value*.32+(low[i]*.035 if kind=='air' else 0)

out=ROOT/'public'/'audio';out.mkdir(parents=True,exist_ok=True)
for kind in ['warm','chords','air','bells','rain','ocean','stream','forest','white','pink','brown','soft']:
    vals=[noise(kind,i,i/RATE) for i in range(N)]
    # Overlap the end with the beginning, then remove the duplicated head.
    # Last output sample is adjacent to the first in the original signal.
    fade=440
    original=vals
    vals=original[fade:]
    for i in range(fade):
        a=(i+1)/fade
        vals[-fade+i]=original[N-fade+i]*(1-a)+original[i]*a
    # Match comfortable RMS across options; retain plenty of headroom.
    rms=math.sqrt(sum(v*v for v in vals)/len(vals));gain=.12/max(rms,.001)
    with wave.open(str(out/f'{kind}.wav'),'wb') as w:
        w.setparams((1,2,RATE,0,'NONE','not compressed'))
        w.writeframes(b''.join(struct.pack('<h',int(max(-.8,min(.8,v*gain))*32767)) for v in vals))
    print(kind)

def png(size):
    rows=[]
    for y in range(size):
        row=bytearray([0])
        for x in range(size):
            dx=x-size/2;dy=y-size/2;r=math.hypot(dx,dy)
            col=(17,28,26)
            if r<size*.28:
                col=(194,213,164) if dy>-.3*dx else (78,100,67)
            if size*.30<r<size*.305:col=(124,146,99)
            row.extend(col)
        rows.append(bytes(row))
    def chunk(k,v):return struct.pack('>I',len(v))+k+v+struct.pack('>I',zlib.crc32(k+v)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows)))+chunk(b'IEND',b'')
for s in (192,512):(ROOT/'public'/f'icon-{s}.png').write_bytes(png(s))
