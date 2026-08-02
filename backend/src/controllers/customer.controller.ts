import { Request, Response } from "express";
import { CustomerService } from "../services/customer.service";

const service = new CustomerService();

export class CustomerController {
  getAll(req: Request, res: Response) {
    res.json(service.getCustomers());
  }
}