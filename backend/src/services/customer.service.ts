import { CustomerRepository } from "../repositories/customer.repository";

export class CustomerService {
  private repository = new CustomerRepository();

  getCustomers() {
    return this.repository.getAll();
  }
}