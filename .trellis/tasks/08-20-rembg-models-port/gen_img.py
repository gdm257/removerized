from PIL import Image, ImageDraw
img = Image.new("RGB", (640, 480), (135, 206, 235))  # sky
d = ImageDraw.Draw(img)
d.rectangle([40, 260, 300, 470], fill=(160, 120, 90), outline=(90, 60, 40), width=4)  # house body
d.polygon([(30, 260), (170, 170), (310, 260)], fill=(180, 60, 50))  # roof
d.rectangle([150, 340, 210, 470], fill=(90, 60, 40))  # door
d.rectangle([420, 120, 470, 300], fill=(100, 75, 50))  # person torso legs
d.rectangle([405, 60, 485, 130], fill=(240, 200, 160))  # head
d.rectangle([390, 125, 500, 230], fill=(200, 30, 30))  # red upper
d.rectangle([405, 230, 485, 360], fill=(30, 50, 160))  # blue lower
img.save(".smoke-test.png")
print("ok 640x480")
