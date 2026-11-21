import os
from PIL import Image

src_path = r"C:\Users\PIYUSH\.gemini\antigravity\brain\55276224-84f5-49aa-84b1-ba126b721fc0\.user_uploaded\media_1795240940415_1740a8eb.jpg"

if not os.path.exists(src_path):
    raise FileNotFoundError(f"Source file not found at {src_path}")

img = Image.open(src_path).convert("RGBA")

# Target folders and sizes
targets = [
    ("frontend/public/logo.png", (512, 512)),
    ("frontend/public/favicon.png", (64, 64)),
    ("frontend/src/assets/logo.png", (512, 512)),
    ("frontend/android/app/src/main/res/mipmap-mdpi/ic_launcher.png", (48, 48)),
    ("frontend/android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png", (48, 48)),
    ("frontend/android/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.png", (108, 108)),
    ("frontend/android/app/src/main/res/mipmap-hdpi/ic_launcher.png", (72, 72)),
    ("frontend/android/app/src/main/res/mipmap-hdpi/ic_launcher_round.png", (72, 72)),
    ("frontend/android/app/src/main/res/mipmap-hdpi/ic_launcher_foreground.png", (162, 162)),
    ("frontend/android/app/src/main/res/mipmap-xhdpi/ic_launcher.png", (96, 96)),
    ("frontend/android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.png", (96, 96)),
    ("frontend/android/app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.png", (216, 216)),
    ("frontend/android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png", (144, 144)),
    ("frontend/android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png", (144, 144)),
    ("frontend/android/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.png", (324, 324)),
    ("frontend/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png", (192, 192)),
    ("frontend/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png", (192, 192)),
    ("frontend/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png", (432, 432)),
]

for rel_path, size in targets:
    abs_path = os.path.abspath(rel_path)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    resized = img.resize(size, Image.Resampling.LANCZOS)
    resized.save(abs_path, format="PNG")
    print(f"Generated {abs_path} ({size[0]}x{size[1]})")

print("All app icons updated successfully!")
