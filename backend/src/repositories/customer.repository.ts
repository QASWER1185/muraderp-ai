export interface Customer {
  id: number;
  name: string;
  phone: string;
  city: string;
}

export class CustomerRepository {
  getAll(): Customer[] {
    return [
      {
        id: 1,
        name: "Ali Traders",
        phone: "03001234567",
        city: "Lahore",
      },
      {
        id: 2,
        name: "Ahmed Builders",
        phone: "03111234567",
        city: "Kasur",
      },
    ];
  }
}