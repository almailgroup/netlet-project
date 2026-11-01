/**
 * The picture beside a subcategory's name on the Categories page.
 *
 * The choice lives on the subcategory (`Shared/commerce/subcategories.ts`) as
 * the name of what it depicts, the departments' rule (`DepartmentIcon`); this
 * is the one place that turns the name into a lucide drawing. The record is
 * keyed by the closed union, so a name added there without a drawing here is
 * a type error.
 *
 * Lucide has no dress, so women's clothing is drawn here in lucide's own
 * hand — a 24 grid, a 2px round-capped line — so it sits with the rest.
 *
 * **Always `aria-hidden`**: it sits beside the subcategory's own name, and
 * read aloud it would say the name twice.
 */
import {
  Bath, BedDouble, Brush, Cable, Camera, Cookie, Croissant, CupSoda, Drumstick, Droplets, Dumbbell, Footprints,
  Gamepad2, Glasses, Headphones, Lamp, Laptop, Microwave, Milk, Apple, Scissors, Shirt, ShoppingBag, Smartphone,
  Sofa, Sparkles, SprayCan, Tablet, Tv, Utensils, Baby, WashingMachine, Watch, Wheat, type LucideIcon, type LucideProps,
} from "lucide-react";
import type { SubcategoryIcon as IconName } from "@shared/commerce/subcategories";

function Dress(props: LucideProps) {
  const { className, strokeWidth = 2 } = props;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {/* Two straps, a scooped neck, the bodice to the waist and the skirt
          flaring to its hem. */}
      <path d="M8.5 2.5 9 5.8l-.7 2.8c-.3 1 .3 1.9 1.3 1.9L5 19.8c-.4.8.2 1.7 1.1 1.7h11.8c.9 0 1.5-.9 1.1-1.7l-4.6-9.3c1 0 1.6-.9 1.3-1.9L15 5.8l.5-3.3" />
      <path d="M9 5.8c1.3 1.7 4.7 1.7 6 0" />
      <path d="M9.6 10.5h4.8" />
    </svg>
  );
}

const DRAWINGS: Record<IconName, LucideIcon | typeof Dress> = {
  phone: Smartphone,
  tablet: Tablet,
  laptop: Laptop,
  headphones: Headphones,
  watch: Watch,
  tv: Tv,
  camera: Camera,
  gamepad: Gamepad2,
  cable: Cable,
  microwave: Microwave,
  dining: Utensils,
  sofa: Sofa,
  lamp: Lamp,
  bed: BedDouble,
  washer: WashingMachine,
  spray: SprayCan,
  drop: Droplets,
  brush: Brush,
  scissors: Scissors,
  sparkles: Sparkles,
  bath: Bath,
  dress: Dress,
  shirt: Shirt,
  baby: Baby,
  shoe: Footprints,
  bag: ShoppingBag,
  glasses: Glasses,
  dumbbell: Dumbbell,
  produce: Apple,
  wheat: Wheat,
  milk: Milk,
  croissant: Croissant,
  cookie: Cookie,
  cup: CupSoda,
  meat: Drumstick,
};

export function SubcategoryIcon({ icon, className = "size-6" }: { icon: IconName; className?: string }) {
  const Drawing = DRAWINGS[icon];
  return <Drawing className={className} strokeWidth={1.75} aria-hidden />;
}
