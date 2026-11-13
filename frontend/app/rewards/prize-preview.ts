// Transcribed as category-level IDEAS from the supplied MegaMitra Rewards flyer.
// NOT an authoritative prize table, approved public catalogue, draw schedule,
// published season policy, winner register, or guarantee of availability.
// The authenticated /member/rewards route shows season-specific published data.
export type PrizeConcept = {
  month: number;
  headline: string;
  accompanying: string;
  kind: 'scooter' | 'car' | 'bike' | 'gold';
};

export const flyerPrizeConcepts: readonly PrizeConcept[] = [
  { month: 1, headline: 'EV scooter, gold jewellery', accompanying: 'Kitchen appliances', kind: 'scooter' },
  { month: 2, headline: 'Car and EV scooter', accompanying: 'Gold jewellery', kind: 'car' },
  { month: 3, headline: 'Motorbike and EV scooter', accompanying: 'Gold jewellery and smart TV', kind: 'bike' },
  { month: 4, headline: 'Scooter collection', accompanying: 'Gold jewellery and refrigerator', kind: 'scooter' },
  { month: 5, headline: 'Scooter collection', accompanying: 'Gold jewellery and washing machine', kind: 'scooter' },
  { month: 6, headline: 'Motorbike and EV scooter', accompanying: 'Gold jewellery and smartphone', kind: 'bike' },
  { month: 7, headline: 'EV scooter and gold jewellery', accompanying: 'Smart TV', kind: 'scooter' },
  { month: 8, headline: 'EV scooter and gold jewellery', accompanying: 'Double-door refrigerator', kind: 'scooter' },
  { month: 9, headline: 'EV scooter and gold jewellery', accompanying: 'Washing machine', kind: 'scooter' },
  { month: 10, headline: 'Car and EV scooter', accompanying: 'Gold jewellery and electronics', kind: 'car' },
  { month: 11, headline: 'Motorbike and EV scooter', accompanying: 'Gold jewellery and laptop', kind: 'bike' },
  { month: 12, headline: 'EV scooter and gold jewellery', accompanying: 'Home theatre system', kind: 'scooter' },
  { month: 13, headline: 'Motorbike and EV scooter', accompanying: 'Gold jewellery', kind: 'bike' },
  { month: 14, headline: 'EV scooter and gold jewellery', accompanying: 'Air conditioner', kind: 'scooter' },
  { month: 15, headline: 'EV scooter and gold jewellery', accompanying: 'Gold coins', kind: 'gold' },
  { month: 16, headline: 'EV scooter and gold jewellery', accompanying: 'Furniture set', kind: 'gold' },
  { month: 17, headline: 'EV scooter and gold jewellery', accompanying: 'Smartphone', kind: 'scooter' },
  { month: 18, headline: 'Cars and EV scooter', accompanying: 'Gold jewellery and electronics', kind: 'car' },
];
