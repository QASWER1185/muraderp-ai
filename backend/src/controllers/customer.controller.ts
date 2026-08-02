import { Request, Response } from "express";
import { CustomerService } from "../services/customer.service";
import { Customer } from "../models/customer.model";

const service = new CustomerService();

export class CustomerController {
  getAll(_req: Request, res: Response) {
    res.json(service.getCustomers());
  }

  add(req: Request, res: Response) {
    const customer: Customer = req.body;

    const newCustomer = service.addCustomer(customer);

    res.status(201).json({
      success: true,
      message: "Customer added successfully",
      data: newCustomer,
    });
  }
}