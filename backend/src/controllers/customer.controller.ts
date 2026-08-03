import { Request, Response } from "express";
import { CustomerService } from "../services/customer.service";
import { Customer } from "../models/customer.model";

const service = new CustomerService();

export class CustomerController {

  // GET
  getAll(_req: Request, res: Response) {
    res.json(service.getCustomers());
  }

  // POST
  add(req: Request, res: Response) {
    const customer: Customer = req.body;

    const newCustomer = service.addCustomer(customer);

    res.status(201).json({
      success: true,
      message: "Customer added successfully",
      data: newCustomer,
    });
  }

  // PUT
  update(req: Request, res: Response) {
    const id = Number(req.params.id);
    const customer: Customer = req.body;

    const updatedCustomer = service.updateCustomer(id, customer);

    if (!updatedCustomer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    return res.json({
      success: true,
      message: "Customer updated successfully",
      data: updatedCustomer,
    });
  }

  // DELETE
  delete(req: Request, res: Response) {
    const id = Number(req.params.id);

    const deleted = service.deleteCustomer(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    return res.json({
      success: true,
      message: "Customer deleted successfully",
    });
  }
}