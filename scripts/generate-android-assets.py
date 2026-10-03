"""Gera ícones (legacy + adaptativo) e splash do app Android a partir dos ícones do Blockbench.
Uso (raiz do repo): python3 scripts/generate-android-assets.py   (requer Pillow)
Saída: android-overlay/res/  (copiado para o projeto Android por scripts/android-overlay.mjs)"""
import os
from PIL import Image

OUT = 'android-overlay/res'
BG_ICON = (27, 146, 215)      # azul do Blockbench (fundo do ícone adaptativo)
BG_SPLASH = (18, 22, 27)      # fundo escuro do app

dens = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
circle = Image.open('icon.png').convert('RGBA')            # 1024, círculo em fundo transparente
maskable = Image.open('icon_maskable.png').convert('RGB')  # 256, sangrado, pensado para máscara

def save(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)

for d, f in dens.items():
    legacy = int(48 * f)
    img = circle.resize((legacy, legacy), Image.LANCZOS)
    save(img, f'{OUT}/mipmap-{d}/ic_launcher.png')
    save(img, f'{OUT}/mipmap-{d}/ic_launcher_round.png')
    # adaptativo: canvas 108dp; a janela visível é a central de 72dp, a arte ocupa 81dp (75%)
    canvas = int(108 * f)
    art = int(canvas * 0.75)
    fg = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
    fg.paste(maskable.resize((art, art), Image.LANCZOS).convert('RGBA'), ((canvas - art) // 2,) * 2)
    save(fg, f'{OUT}/mipmap-{d}/ic_launcher_foreground.png')

os.makedirs(f'{OUT}/values', exist_ok=True)
open(f'{OUT}/values/ic_launcher_background.xml', 'w').write(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
    '    <color name="ic_launcher_background">#%02X%02X%02X</color>\n</resources>\n' % BG_ICON)

# splash (tema de lançamento do Capacitor usa @drawable/splash): fundo escuro + ícone centralizado
port = {'mdpi': (320, 480), 'hdpi': (480, 800), 'xhdpi': (720, 1280), 'xxhdpi': (960, 1600), 'xxxhdpi': (1280, 1920)}
def splash(w, h):
    img = Image.new('RGBA', (w, h), BG_SPLASH + (255,))
    s = int(min(w, h) * 0.32)
    ic = circle.resize((s, s), Image.LANCZOS)
    img.alpha_composite(ic, ((w - s) // 2, (h - s) // 2))
    return img.convert('RGB')
for d, (w, h) in port.items():
    save(splash(w, h), f'{OUT}/drawable-port-{d}/splash.png')
    save(splash(h, w), f'{OUT}/drawable-land-{d}/splash.png')
save(splash(480, 320), f'{OUT}/drawable/splash.png')
print('ok')
