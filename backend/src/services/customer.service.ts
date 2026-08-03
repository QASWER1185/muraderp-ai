import { Customer } from "../models/customer.model";
import { CustomerRepository } from "../repositories/customer.repository";

export class CustomerService {
  private repository = new CustomerRepository();

  getCustomers(): Customer[] {
    return this.repository.getAll();
  }

  addCustomer(customer: Customer): Customer {
    return this.repository.add(customer);
  }

  updateCustomer(id: number, customer: Customer): Customer | null {
    return this.repository.update(id, customer);
  }

  deleteCustomer(id: number): boolean {
    return this.repository.delete(id);
  }
}