// Uproszczona mapa Polski z podziałem na 16 województw.
// Kształty są schematyczne, ale zachowują wzajemne położenie regionów.

export type RegionShape = { id: string; name: string; points: string; label: [number, number] };

export const REGION_SHAPES: RegionShape[] = [
  { id: "zachodniopomorskie", name: "Zachodniopomorskie", points: "8,10 30,6 33,22 26,34 10,32 4,20", label: [18, 20] },
  { id: "pomorskie", name: "Pomorskie", points: "30,6 56,4 58,20 46,26 33,22", label: [44, 15] },
  { id: "warminsko-mazurskie", name: "Warmińsko-mazurskie", points: "56,4 84,8 86,24 70,30 58,20", label: [71, 17] },
  { id: "lubuskie", name: "Lubuskie", points: "10,32 26,34 28,50 20,56 8,48", label: [18, 43] },
  { id: "wielkopolskie", name: "Wielkopolskie", points: "26,34 46,26 52,38 48,54 34,58 28,50", label: [39, 43] },
  { id: "kujawsko-pomorskie", name: "Kujawsko-pomorskie", points: "46,26 58,20 64,30 58,42 52,38", label: [55, 31] },
  { id: "mazowieckie", name: "Mazowieckie", points: "58,20 70,30 80,44 74,58 60,58 56,46 58,42", label: [66, 43] },
  { id: "podlaskie", name: "Podlaskie", points: "70,30 86,24 92,42 80,44", label: [82, 35] },
  { id: "dolnoslaskie", name: "Dolnośląskie", points: "20,56 28,50 34,58 32,72 20,74 14,64", label: [24, 63] },
  { id: "opolskie", name: "Opolskie", points: "34,58 48,54 50,64 42,72 32,72", label: [41, 64] },
  { id: "lodzkie", name: "Łódzkie", points: "48,54 56,46 60,58 56,68 50,64", label: [54, 58] },
  { id: "swietokrzyskie", name: "Świętokrzyskie", points: "60,58 74,58 72,70 62,70 56,68", label: [65, 64] },
  { id: "lubelskie", name: "Lubelskie", points: "74,58 80,44 92,42 90,62 82,74 72,70", label: [82, 57] },
  { id: "slaskie", name: "Śląskie", points: "42,72 50,64 56,68 54,84 44,86", label: [49, 76] },
  { id: "malopolskie", name: "Małopolskie", points: "54,84 56,68 62,70 72,70 70,82 58,90", label: [63, 79] },
  { id: "podkarpackie", name: "Podkarpackie", points: "72,70 82,74 84,88 70,92 70,82", label: [77, 81] },
];

export function PolandMap({
  counts,
  onSelect,
  activeId,
}: {
  counts: Record<string, number>;
  onSelect?: (id: string) => void;
  activeId?: string | null;
}) {
  const max = Math.max(1, ...Object.values(counts));

  return (
    <svg viewBox="0 0 100 100" className="h-auto w-full" role="img" aria-label="Mapa Polski z liczbą wysłanych wiadomości">
      {REGION_SHAPES.map((region) => {
        const count = counts[region.id] ?? 0;
        const intensity = count === 0 ? 0 : 0.18 + (count / max) * 0.62;
        const active = activeId === region.id;
        return (
          <g
            key={region.id}
            onClick={() => onSelect?.(region.id)}
            className={onSelect ? "cursor-pointer" : undefined}
          >
            <title>{`${region.name}: ${count}`}</title>
            <polygon
              points={region.points}
              fill="currentColor"
              fillOpacity={intensity}
              className="text-primary transition-[fill-opacity]"
              stroke="currentColor"
              strokeOpacity={active ? 0.9 : 0.35}
              strokeWidth={active ? 0.9 : 0.4}
              strokeLinejoin="round"
            />
            <text
              x={region.label[0]}
              y={region.label[1]}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-foreground font-semibold"
              style={{ fontSize: 3.4 }}
            >
              {count}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
