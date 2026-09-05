// Types for the subset of the Just Eat for Business (ex City Pantry) API that we use.

export interface Dietaries {
  vegetarian: boolean;
  vegan: boolean;
  noNuts: boolean;
  noGluten: boolean;
  noDairy: boolean;
  halal: boolean;
  pescatarian: boolean;
  none: boolean;
}

export type DietKey = Exclude<keyof Dietaries, 'none'>;

export interface Allergens {
  [k: string]: boolean;
}

export interface ImageSet {
  thumbnail?: string;
  medium?: string;
  large?: string;
  original?: string;
}

export interface Availability {
  useAllLocations: boolean;
  locationIds: string[];
}

export interface BaseItem {
  type: 'SingleItem' | 'CustomItem' | 'ItemBundle';
  id: string;
  name: string;
  description: string | null;
  images?: ImageSet[];
  price: number;
  availability?: Availability;
  dietaries: Dietaries;
  possibleDietaries?: Dietaries;
  allergens?: Allergens;
  ingredients?: string[];
  foodType?: string;
  kcal?: number | null;
  spicy?: boolean;
  hot?: boolean;
  cuisine?: string;
  // CustomItem only
  sections?: { name: string; minOptions: number; maxOptions: number; options: { name: string; price: number; dietaries: Dietaries }[] }[];
  // ItemBundle only
  groups?: { type: string; heading: string; items: BaseItem[] }[];
}

export interface MenuSection {
  title: string;
  hidden: boolean;
  items: BaseItem[];
}

export interface Summary {
  item: {
    vendor: { id: string; name: string; rating?: number; reviewsCount?: number };
    individualChoice: {
      menuContent: { sections: MenuSection[] };
      budget: number | null;
      choiceDeadline: string;
    };
    requestedDeliveryDate: string;
    selectedVendorLocation?: { id: string; name: string } | null;
  };
}

export type CapacityStatus = 'AVAILABLE' | 'ALMOST_SOLD_OUT' | 'SOLD_OUT' | string;

export interface EaterOption {
  orderId: string;
  orderHumanId: number;
  vendorId: string;
  vendorName: string;
  vendorLocationName: string;
  vendorImage?: ImageSet[];
  itemIds?: string[];
  itemNames?: string[];
  vendorLocationCapacityStatus: CapacityStatus;
}

export interface Cart {
  orderId: string;
  isCancelled: boolean;
  requestedDeliveryDate: string;
  orderDeadline: string;
  choiceOpenTime: string;
  choiceDeadline: string;
  eaterOptions: EaterOption[];
  location: { name: string };
}

export interface CartsResponse {
  count: number;
  items: Cart[];
}

/** One flattened, comparable row in the comparison table. */
export interface Row {
  key: string;
  name: string;
  description: string;
  price: number;
  kcal: number | null;
  type: BaseItem['type'];
  section: string;
  foodType: string;
  image: string | null;
  imageLarge: string | null;
  vendorName: string;
  vendorLocationName: string;
  orderId: string;
  orderHumanId: number;
  slot: string;
  capacity: CapacityStatus;
  dietaries: Dietaries;
  possibleDietaries: Dietaries;
  allergens: string[];
  ingredients: string[];
  spicy: boolean;
  budget: number | null;
  chosen: boolean;
}
