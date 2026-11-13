// Transcribed as prize-category IDEAS from the user's supplied 18-month rewards flyer.
// Product names are reference examples only, never confirmed future awards.
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
  { month: 3, headline: 'Hero HF 100 and EV scooter', accompanying: 'Gold jewellery and smart TV', kind: 'bike' },
  { month: 4, headline: 'Honda Activa and EV scooter', accompanying: 'Gold jewellery and refrigerator', kind: 'scooter' },
  { month: 5, headline: 'TVS Jupiter and EV scooter', accompanying: 'Gold jewellery and washing machine', kind: 'scooter' },
  { month: 6, headline: 'Honda Shine and EV scooter', accompanying: 'Gold jewellery and 5G smartphone', kind: 'bike' },
  { month: 7, headline: 'EV scooter and gold jewellery', accompanying: 'Smart TV', kind: 'scooter' },
  { month: 8, headline: 'EV scooter and gold jewellery', accompanying: 'Double-door refrigerator', kind: 'scooter' },
  { month: 9, headline: 'EV scooter and gold jewellery', accompanying: 'Washing machine', kind: 'scooter' },
  { month: 10, headline: 'Car and EV scooter', accompanying: 'Gold jewellery and electronics', kind: 'car' },
  { month: 11, headline: 'Bajaj Pulsar 150 and EV scooter', accompanying: 'Gold jewellery and laptop', kind: 'bike' },
  { month: 12, headline: 'EV scooter and gold jewellery', accompanying: 'Home theatre system', kind: 'scooter' },
  { month: 13, headline: 'Royal Enfield Classic 350 and EV scooter', accompanying: 'Gold jewellery', kind: 'bike' },
  { month: 14, headline: 'EV scooter and gold jewellery', accompanying: 'Air conditioner', kind: 'scooter' },
  { month: 15, headline: 'EV scooter and gold jewellery', accompanying: 'Gold coins (10 grams)', kind: 'gold' },
  { month: 16, headline: 'EV scooter and gold jewellery', accompanying: 'Furniture set', kind: 'gold' },
  { month: 17, headline: 'EV scooter and gold jewellery', accompanying: '5G smartphone', kind: 'scooter' },
  { month: 18, headline: 'Two cars and EV scooter', accompanying: 'Gold jewellery and electronics', kind: 'car' },
];
