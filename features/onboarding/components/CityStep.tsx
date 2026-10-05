
import React from 'react';
import { motion as _motion } from 'framer-motion';
import { Check, MapPin } from 'lucide-react';
import { CityMode } from '../../../types';

const motion = _motion as any;

type SelectableCity = Exclude<CityMode, null | 'Tehran'>;

const CITIES: { id: SelectableCity; name: string; desc: string; img: string }[] = [
  { id: 'Istanbul', name: 'استانبول', desc: 'شهر رنگ‌ها و طعم‌های شرقی', img: 'https://images.unsplash.com/photo-1524231757912-21f4fe3a7200?auto=format&q=75&w=600' },
  { id: 'Dubai', name: 'دبی', desc: 'تجربه دنیای مدرن و لوکس', img: 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?auto=format&q=75&w=600' },
];

interface CityStepProps {
  selectedCity: CityMode;
  onSelect: (city: SelectableCity) => void;
}

export const CityStep: React.FC<CityStepProps> = ({ selectedCity, onSelect }) => (
  <motion.div
    initial={{ opacity: 0, x: -16 }}
    animate={{ opacity: 1, x: 0 }}
    exit={{ opacity: 0, x: 16 }}
    className="space-y-6"
  >
    <div className="text-right space-y-1.5">
      <h1 className="rava-page-title text-2xl leading-snug">کجا قراره خاطره بسازیم؟</h1>
      <p className="rava-page-subtitle">مقصد سفرت رو انتخاب کن.</p>
    </div>

    <div className="grid grid-cols-2 gap-3 pb-2">
      {CITIES.map((city) => {
        const selected = selectedCity === city.id;
        return (
          <button
            key={city.id}
            type="button"
            onClick={() => onSelect(city.id)}
            className={`relative overflow-hidden rounded-rava-xl text-right outline-none transition-all active:scale-[0.98] ${
              selected
                ? 'ring-2 ring-rava-gold/80 shadow-[0_0_20px_rgba(234,179,8,0.15)]'
                : 'ring-1 ring-white/10 opacity-90'
            }`}
          >
            <div className="aspect-[4/3] relative">
              <img src={city.img} className="absolute inset-0 w-full h-full object-cover" alt="" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
              <div className="absolute bottom-0 inset-x-0 p-3">
                <div className="mb-0.5 flex items-center justify-end gap-1 text-rava-gold">
                  <span className="text-rava-sm font-black text-white">{city.name}</span>
                  <MapPin size={14} />
                </div>
                <p className="text-rava-xs font-bold leading-snug text-white/55">{city.desc}</p>
              </div>
              {selected && (
                <div className="absolute start-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-rava-gold text-black">
                  <Check size={14} strokeWidth={3} />
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  </motion.div>
);
