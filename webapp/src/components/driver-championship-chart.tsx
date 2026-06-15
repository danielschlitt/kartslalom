import type { DriverChartData, FinishMarker } from "@/lib/dal/drivers";

const VIEWBOX_WIDTH = 880;
const PADDING_LEFT = 44;
const PADDING_RIGHT = 140;
const PADDING_TOP = 28;
const PADDING_BOTTOM = 44;
const PLOT_WIDTH = VIEWBOX_WIDTH - PADDING_LEFT - PADDING_RIGHT;

const ROW_HEIGHT = 28;
const MIN_PLOT_HEIGHT = 240;

const COLOR_FINISH = "#3b82f6";
const COLOR_OWN = "#f8fafc";
const COLORS_AHEAD = ["#ef4444", "#fca5a5"];
const COLORS_BEHIND = ["#22c55e", "#86efac"];
const COLOR_GRID = "rgba(255,255,255,0.06)";
const COLOR_AXIS = "rgba(255,255,255,0.18)";
const COLOR_AXIS_TEXT = "rgba(255,255,255,0.55)";

type Point = { x: number; y: number };

function scaleX(index: number, total: number): number {
  if (total <= 1) return PADDING_LEFT + PLOT_WIDTH / 2;
  return PADDING_LEFT + (index / (total - 1)) * PLOT_WIDTH;
}

function makeScaleY(driverCount: number, plotHeight: number) {
  const max = Math.max(driverCount, 1);
  return (rank: number): number => {
    if (max === 1) return PADDING_TOP + plotHeight / 2;
    return PADDING_TOP + ((rank - 1) / (max - 1)) * plotHeight;
  };
}

function toPoints(
  ranks: (number | null)[],
  scaleY: (rank: number) => number,
): { points: Point[]; segments: Point[][] } {
  const points: Point[] = [];
  const segments: Point[][] = [];
  let current: Point[] = [];
  ranks.forEach((rank, i) => {
    if (rank == null) {
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
      return;
    }
    const p = { x: scaleX(i, ranks.length), y: scaleY(rank) };
    points.push(p);
    current.push(p);
  });
  if (current.length > 0) segments.push(current);
  return { points, segments };
}

function PolyLine({
  segments,
  color,
  strokeWidth,
}: {
  segments: Point[][];
  color: string;
  strokeWidth: number;
}) {
  return (
    <>
      {segments.map((seg, i) =>
        seg.length >= 2 ? (
          <polyline
            key={i}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            points={seg.map((p) => `${p.x},${p.y}`).join(" ")}
          />
        ) : null,
      )}
    </>
  );
}

function Dots({
  points,
  color,
  radius,
}: {
  points: Point[];
  color: string;
  radius: number;
}) {
  return (
    <>
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={radius} fill={color} />
      ))}
    </>
  );
}

function EndLabel({
  points,
  text,
  color,
  fontSize = 12,
}: {
  points: Point[];
  text: string;
  color: string;
  fontSize?: number;
}) {
  const last = points[points.length - 1];
  if (!last) return null;
  return (
    <text
      x={last.x + 8}
      y={last.y + 4}
      fontSize={fontSize}
      fontWeight={600}
      fill={color}
    >
      {text}
    </text>
  );
}

export function DriverChampionshipChart({
  data,
}: {
  data: DriverChartData;
}) {
  const { driverCount, raceNumbers, driver, ahead, behind } = data;

  if (raceNumbers.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-muted)]">
        Noch keine Rennen in dieser Serie gefahren.
      </div>
    );
  }

  const plotHeight = Math.max(MIN_PLOT_HEIGHT, driverCount * ROW_HEIGHT);
  const viewBoxHeight = PADDING_TOP + plotHeight + PADDING_BOTTOM;
  const scaleY = makeScaleY(driverCount, plotHeight);

  const own = toPoints(driver.cumulativeRanks, scaleY);
  const aheadLines = ahead.map((line) => ({
    line,
    rendered: toPoints(line.cumulativeRanks, scaleY),
  }));
  const behindLines = behind.map((line) => ({
    line,
    rendered: toPoints(line.cumulativeRanks, scaleY),
  }));

  // Per-race finish markers for the driver: rings for real positions, small
  // squares pinned to the very last row for races they missed.
  const finishRings: Point[] = [];
  const missedSquares: Point[] = [];
  driver.finishPositions.forEach((marker: FinishMarker, i) => {
    const x = scaleX(i, raceNumbers.length);
    if (typeof marker === "number") {
      finishRings.push({ x, y: scaleY(marker) });
    } else if (marker === "missed") {
      missedSquares.push({ x, y: scaleY(driverCount) });
    }
  });

  const yTicks: number[] = [];
  for (let r = 1; r <= driverCount; r++) yTicks.push(r);

  const finishRadius = 8;
  const finishStroke = 2;
  const missedSize = 9;

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <svg
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${viewBoxHeight}`}
        role="img"
        aria-label={`Verlauf Meisterschaft ${data.seriesLabel} ${data.ageClassName}`}
        className="block h-auto w-full"
      >
        {yTicks.map((r) => (
          <line
            key={`gy-${r}`}
            x1={PADDING_LEFT}
            x2={PADDING_LEFT + PLOT_WIDTH}
            y1={scaleY(r)}
            y2={scaleY(r)}
            stroke={COLOR_GRID}
            strokeWidth={1}
          />
        ))}
        {raceNumbers.map((_, i) => (
          <line
            key={`gx-${i}`}
            y1={PADDING_TOP}
            y2={PADDING_TOP + plotHeight}
            x1={scaleX(i, raceNumbers.length)}
            x2={scaleX(i, raceNumbers.length)}
            stroke={COLOR_GRID}
            strokeWidth={1}
          />
        ))}

        <line
          x1={PADDING_LEFT}
          x2={PADDING_LEFT}
          y1={PADDING_TOP}
          y2={PADDING_TOP + plotHeight}
          stroke={COLOR_AXIS}
        />
        <line
          x1={PADDING_LEFT}
          x2={PADDING_LEFT + PLOT_WIDTH}
          y1={PADDING_TOP + plotHeight}
          y2={PADDING_TOP + plotHeight}
          stroke={COLOR_AXIS}
        />

        {yTicks.map((r) => (
          <text
            key={`yl-${r}`}
            x={PADDING_LEFT - 8}
            y={scaleY(r) + 4}
            fontSize={11}
            textAnchor="end"
            fill={COLOR_AXIS_TEXT}
          >
            {r}
          </text>
        ))}
        {raceNumbers.map((n, i) => (
          <text
            key={`xl-${n}`}
            x={scaleX(i, raceNumbers.length)}
            y={PADDING_TOP + plotHeight + 18}
            fontSize={11}
            textAnchor="middle"
            fill={COLOR_AXIS_TEXT}
          >
            R{n}
          </text>
        ))}

        {aheadLines.map(({ line, rendered }, i) => {
          const color = COLORS_AHEAD[i] ?? COLORS_AHEAD[COLORS_AHEAD.length - 1];
          return (
            <g key={`ahead-${line.driverId}`}>
              <PolyLine
                segments={rendered.segments}
                color={color}
                strokeWidth={1.5}
              />
              <Dots points={rendered.points} color={color} radius={3} />
              <EndLabel points={rendered.points} text={line.name} color={color} />
            </g>
          );
        })}
        {behindLines.map(({ line, rendered }, i) => {
          const color =
            COLORS_BEHIND[i] ?? COLORS_BEHIND[COLORS_BEHIND.length - 1];
          return (
            <g key={`behind-${line.driverId}`}>
              <PolyLine
                segments={rendered.segments}
                color={color}
                strokeWidth={1.5}
              />
              <Dots points={rendered.points} color={color} radius={3} />
              <EndLabel points={rendered.points} text={line.name} color={color} />
            </g>
          );
        })}

        <PolyLine
          segments={own.segments}
          color={COLOR_OWN}
          strokeWidth={3}
        />
        <Dots points={own.points} color={COLOR_OWN} radius={5} />
        <EndLabel points={own.points} text={driver.name} color={COLOR_OWN} />

        {finishRings.map((p, i) => (
          <circle
            key={`ring-${i}`}
            cx={p.x}
            cy={p.y}
            r={finishRadius}
            fill="none"
            stroke={COLOR_FINISH}
            strokeWidth={finishStroke}
          />
        ))}
        {missedSquares.map((p, i) => (
          <rect
            key={`miss-${i}`}
            x={p.x - missedSize / 2}
            y={p.y - missedSize / 2}
            width={missedSize}
            height={missedSize}
            fill={COLOR_FINISH}
          >
            <title>Rennen verpasst</title>
          </rect>
        ))}
      </svg>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-muted)]">
        <Legend color={COLOR_OWN} label="Eigene Position (kumuliert)" />
        {aheadLines.map(({ line }, i) => (
          <Legend
            key={`legend-ahead-${line.driverId}`}
            color={COLORS_AHEAD[i] ?? COLORS_AHEAD[COLORS_AHEAD.length - 1]}
            label={`Vor: ${line.name}`}
          />
        ))}
        {behindLines.map(({ line }, i) => (
          <Legend
            key={`legend-behind-${line.driverId}`}
            color={COLORS_BEHIND[i] ?? COLORS_BEHIND[COLORS_BEHIND.length - 1]}
            label={`Hinter: ${line.name}`}
          />
        ))}
        <Legend
          color={COLOR_FINISH}
          label="Platzierung pro Rennen (Ring)"
          ring
        />
        <Legend
          color={COLOR_FINISH}
          label="Rennen verpasst (Quadrat unten)"
          square
        />
      </div>
    </div>
  );
}

function Legend({
  color,
  label,
  ring,
  square,
}: {
  color: string;
  label: string;
  ring?: boolean;
  square?: boolean;
}) {
  const style = ring
    ? {
        borderColor: color,
        borderWidth: 2,
        backgroundColor: "transparent",
      }
    : { backgroundColor: color };
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-block h-2.5 w-2.5 ${square ? "" : "rounded-full"}`}
        style={style}
      />
      {label}
    </span>
  );
}
