import { Customer } from "../models/customer.model";

export class CustomerRepository {
  private customers: Customer[] = [
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

  getAll(): Customer[] {
    return this.customers;
  }

  add(customer: Customer): Customer {
    this.customers.push(customer);
    return customer;
  }

  update(id: number, customer: Customer): Customer | null {
    const index = this.customers.findIndex(c => c.id === id);

    if (index === -1) {
      return null;
    }

    this.customers[index] = customer;

    return customer;
  }

  delete(id: number): boolean {
    const index = this.customers.findIndex(c => c.id === id);

    if (index === -1) {
      return false;
    }

    this.customers.splice(index, 1);

    return true;
  }
}