from PIL import Image, ImageDraw
import os

def generate_icon():
    # 96x96 크기의 투명 배경 RGBA 이미지 생성
    size = (96, 96)
    img = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 1. 바깥 원형 테두리 (두께 4px)
    draw.ellipse([4, 4, 92, 92], outline=(255, 255, 255, 255), width=4)

    # 2. 태양 (구름 뒤에서 떠오르는 반원, 꽉 채움)
    # bounding box: left, top, right, bottom
    draw.chord([30, 24, 66, 60], start=180, end=360, fill=(255, 255, 255, 255))

    # 3. 구름 (태양과 산맥 사이를 넓게 덮는 둥글둥글 겹쳐진 구름)
    # 왼쪽 덩어리
    draw.ellipse([18, 42, 38, 54], fill=(255, 255, 255, 255))
    # 가운데 큰 덩어리
    draw.ellipse([30, 36, 62, 54], fill=(255, 255, 255, 255))
    # 오른쪽 덩어리
    draw.ellipse([54, 42, 78, 54], fill=(255, 255, 255, 255))
    # 하부 수평 정렬 메우기
    draw.rectangle([18, 48, 78, 54], fill=(255, 255, 255, 255))

    # 4. 산맥 지표면 실루엣 (꽉 채움)
    # 다각형 좌표 (X, Y)
    mountain_coords = [
        (4, 60), 
        (26, 48), 
        (50, 56), 
        (72, 44), 
        (92, 58), 
        (92, 92), 
        (4, 92)
    ]
    draw.polygon(mountain_coords, fill=(255, 255, 255, 255))

    # 5. 물그림자 수평선 3개 (둥근 사각형)
    # 선 1
    draw.rounded_rectangle([32, 66, 64, 69], radius=1.5, fill=(255, 255, 255, 255))
    # 선 2
    draw.rounded_rectangle([38, 73, 58, 76], radius=1.5, fill=(255, 255, 255, 255))
    # 선 3
    draw.rounded_rectangle([44, 80, 52, 83], radius=1.5, fill=(255, 255, 255, 255))

    # 결과물 저장 경로 지정
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    assets_dir = os.path.join(project_root, "assets")

    # png 및 svg 확장자로 둘 다 복사 저장
    png_path = os.path.join(assets_dir, "notification_icon.png")
    svg_path = os.path.join(assets_dir, "notification_icon.svg")

    img.save(png_path, "PNG")
    img.save(svg_path, "PNG")  # 프로젝트 요구에 맞춰 svg 확장자이지만 png 바이너리로 동일 저장

    print(f"Solid notification icons successfully generated at:")
    print(f" - {png_path}")
    print(f" - {svg_path}")

if __name__ == "__main__":
    generate_icon()
