import { useState } from 'react';
import { Sparkles, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { MEGA_NICHES_CATEGORIES, nicheValue, type NicheItem } from '@/lib/niches-catalog';

type Source = 'GOOGLE_MAPS' | 'CEIDG' | 'OLX' | 'maps' | 'ceidg' | 'olx';

/**
 * Katalog 40 nisz w 8 kategoriach — pigułki kategorii rozwijają pigułki nisz.
 * Kliknięcie niszy wypełnia frazę (Mapy/OLX) lub kody PKD (CEIDG).
 */
export function NichePicker({ source, value, onPick, onClear, compact = false }: {
  source: Source;
  value: string;
  onPick: (niche: NicheItem) => void;
  onClear?: () => void;
  compact?: boolean;
}) {
  const [categoryId, setCategoryId] = useState(MEGA_NICHES_CATEGORIES[0]?.id ?? '');
  const category = MEGA_NICHES_CATEGORIES.find(c => c.id === categoryId) ?? MEGA_NICHES_CATEGORIES[0];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-muted-foreground" />
        <Label className="text-sm font-medium">Katalog 40 nisz — wybierz kategorię, potem niszę</Label>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Kategorie nisz">
        {MEGA_NICHES_CATEGORIES.map(c => (
          <Button
            key={c.id}
            type="button"
            variant={c.id === category?.id ? 'default' : 'outline'}
            size="sm"
            aria-pressed={c.id === category?.id}
            className={`rounded-xl cursor-pointer border-0 transition-all hover:scale-[1.02] active:scale-[0.98] ${c.id === category?.id ? '' : 'glass-soft'} ${compact ? 'px-2 py-1 text-xs' : ''}`}
            onClick={() => setCategoryId(c.id)}
          >
            {c.icon} {c.label}
          </Button>
        ))}
      </div>
      {category && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={`Nisze: ${category.label}`}>
          {category.niches.map(n => {
            const nicheVal = nicheValue(n, source);
            const active = value.trim() === nicheVal;
            return (
              <Button
                key={n.id}
                type="button"
                variant={active ? 'default' : 'outline'}
                size="sm"
                aria-pressed={active}
                title={source === 'CEIDG' || source === 'ceidg' ? `PKD: ${n.pkd}` : n.searchQuery}
                className={`h-auto whitespace-normal rounded-xl cursor-pointer border-0 transition-all hover:scale-[1.02] active:scale-[0.98] ${active ? '' : 'glass-soft'} ${compact ? 'px-2 py-1 text-xs' : ''}`}
                onClick={() => onPick(n)}
              >
                {n.icon} {n.label}
              </Button>
            );
          })}
          {value.trim() !== '' && onClear && (
            <Button type="button" variant="ghost" size="sm" className="rounded-xl cursor-pointer text-muted-foreground" onClick={onClear}>
              <XCircle className="mr-2 size-4" />
              Wyczyść
            </Button>
          )}
        </div>
      )}
      {!compact && (
        <p className="text-xs text-muted-foreground">
          Kliknij niszę, aby wstawić jej {source === 'CEIDG' || source === 'ceidg' ? 'kody PKD' : 'frazę'} do pola powyżej — możesz je potem zmienić ręcznie.
        </p>
      )}
    </div>
  );
}
