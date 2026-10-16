import Svg, { Circle, Path, Rect } from 'react-native-svg';

export interface IconShape {
  /** An SVG `<path d="...">` value. */
  d?: string;
  /** An SVG `<circle>`, as `[cx, cy, r]`. */
  circle?: [number, number, number];
  /** An SVG `<rect>`, as `[x, y, width, height, rx?]`. */
  rect?: [number, number, number, number, number?];
}

interface OutlineIconProps {
  shapes: readonly IconShape[];
  size?: number;
  color?: string;
  strokeWidth?: number;
}

/**
 * Every tile/nav/menu glyph on `docs/ui-design/Field_Sales_Beat_App.html`'s
 * boards is a plain 24x24-viewBox stroke icon (fill none, round caps/joins)
 * — this renders one from its `<path>`/`<circle>`/`<rect>` shapes so each
 * call site only has to carry the shape data, not the repeated `Svg`
 * boilerplate.
 */
export function OutlineIcon({
  shapes,
  size = 18,
  color = 'currentColor',
  strokeWidth = 1.8,
}: OutlineIconProps) {
  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      {shapes.map((shape, index) => {
        if (shape.circle) {
          const [cx, cy, r] = shape.circle;
          return (
            <Circle
              cx={cx}
              cy={cy}
              fill="none"
              key={index}
              r={r}
              stroke={color}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={strokeWidth}
            />
          );
        }
        if (shape.rect) {
          const [x, y, width, height, rx] = shape.rect;
          return (
            <Rect
              fill="none"
              height={height}
              key={index}
              rx={rx}
              stroke={color}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={strokeWidth}
              width={width}
              x={x}
              y={y}
            />
          );
        }
        return (
          <Path
            d={shape.d}
            fill="none"
            key={index}
            stroke={color}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={strokeWidth}
          />
        );
      })}
    </Svg>
  );
}
