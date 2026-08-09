import type { Customer } from "../models/customer.model.js";

export class CustomerRepository {
  private readonly customers: Customer[] = [];

  getAll(): Customer[] {
    return this.customers;
  }

  add(customer: Customer): Customer {
    this.customers.push(customer);
    return customer;
  }

  update(id: number, customer: Customer): Customer | null {
    const index = this.customers.findIndex((existingCustomer) => existingCustomer.id === id);

    if (index === -1) {
      return null;
    }

    this.customers[index] = customer;
    return customer;
  }

  delete(id: number): boolean {
    const index = this.customers.findIndex((customer) => customer.id === id);

    if (index === -1) {
      return false;
    }

    this.customers.splice(index, 1);
    return true;
  }
}
