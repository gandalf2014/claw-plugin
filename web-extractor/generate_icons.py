"""生成扩展所需的三张 PNG 图标 (16x16, 48x48, 128x128)"""
import struct, zlib, os

def create_png(width, height):
    """生成一张紫色渐变 + 白色数据提取图标的 PNG"""
    # 构建原始像素数据 (RGBA)
    raw_data = b''
    for y in range(height):
        raw_data += b'\x00'  # filter byte (none)
        for x in range(width):
            # 渐变背景：左上紫蓝 -> 右下紫红
            r = int(102 + (118 - 102) * x / width)   # 102 -> 118
            g = int(126 + (75 - 126) * (x + y) / (width + height))  # 126 -> 75
            b = int(234 - (234 - 162) * y / height)   # 234 -> 162
            a = 255

            # 中心区域画白色图标：大括号 {}
            cx, cy = width / 2, height / 2
            scale = width / 16.0

            # 左大括号
            left_x = cx - 3 * scale
            top_y = cy - 4 * scale
            bot_y = cy + 4 * scale

            # 简化：在中心画一个白色数据提取图标
            # 画左右括号和数据点
            is_icon = False

            # 左括号路径 (bezier-like with pixel check)
            rel_x = x - left_x
            rel_y_from_top = y - top_y
            brace_height = bot_y - top_y

            if -0.5 <= rel_x <= 1.5 and 0 <= rel_y_from_top <= brace_height:
                progress = rel_y_from_top / brace_height
                # 贝塞尔曲线形状的括号
                curve_offset = scale * (1 - (2 * progress - 1) ** 2) * 1.5
                if abs(rel_x - curve_offset) <= 0.8 * scale:
                    is_icon = True

            # 右括号
            right_x = cx + 3 * scale
            rel_x2 = x - right_x
            if -0.5 <= rel_x2 <= 1.5 and 0 <= rel_y_from_top <= brace_height:
                progress = rel_y_from_top / brace_height
                curve_offset = scale * (1 - (2 * progress - 1) ** 2) * 1.5
                if abs(rel_x2 + curve_offset) <= 0.8 * scale:
                    is_icon = True

            # 中间小方块 (数据点)
            dot_size = scale * 1.2
            if abs(x - cx) <= dot_size and abs(y - cy) <= dot_size:
                is_icon = True

            if is_icon:
                raw_data += struct.pack('BBBB', 255, 255, 255, 255)
            else:
                # 圆角效果：四角透明
                corner_dist = ((min(x, width - 1 - x) / max(1, scale * 2)) ** 2 +
                              (min(y, height - 1 - y) / max(1, scale * 2)) ** 2)
                if corner_dist < 0.25:
                    actual_a = int(max(0, 255 * (corner_dist / 0.25)))
                    raw_data += struct.pack('BBBB', r, g, b, actual_a)
                else:
                    raw_data += struct.pack('BBBB', r, g, b, a)

    # PNG 签名
    signature = b'\x89PNG\r\n\x1a\n'

    # IHDR chunk
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)  # 8-bit RGBA
    ihdr_crc = zlib.crc32(b'IHDR' + ihdr_data) & 0xffffffff
    ihdr = struct.pack('>I', 13) + b'IHDR' + ihdr_data + struct.pack('>I', ihdr_crc)

    # IDAT chunk
    compressed = zlib.compress(raw_data)
    idat_crc = zlib.crc32(b'IDAT' + compressed) & 0xffffffff
    idat = struct.pack('>I', len(compressed)) + b'IDAT' + compressed + struct.pack('>I', idat_crc)

    # IEND chunk
    iend_crc = zlib.crc32(b'IEND') & 0xffffffff
    iend = struct.pack('>I', 0) + b'IEND' + struct.pack('>I', iend_crc)

    return signature + ihdr + idat + iend


def main():
    icons_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'icons')
    os.makedirs(icons_dir, exist_ok=True)

    for size in [16, 48, 128]:
        png_data = create_png(size, size)
        path = os.path.join(icons_dir, f'icon{size}.png')
        with open(path, 'wb') as f:
            f.write(png_data)
        print(f'Generated: {path} ({len(png_data)} bytes)')


if __name__ == '__main__':
    main()
