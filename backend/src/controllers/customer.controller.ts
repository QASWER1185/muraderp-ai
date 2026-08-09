import type { Request, Response } from "express";
import type { Customer } from "../models/customer.model.js";
import { CustomerService } from "../services/customer.service.js";

const service = new CustomerService();

export class CustomerController {
  getAll(_request: Request, response: Response) {
    response.status(200).json(service.getCustomers());
  }

  add(request: Request, response: Response) {
    const customer = request.body as Customer;
    const newCustomer = service.addCustomer(customer);

    response.status(201).json({
      success: true,
      message: "Customer added successfully",
      data: newCustomer,
    });
  }

  update(request: Request, response: Response) {
    const id = Number(request.params.id);
    const customer = request.body as Customer;
    const updatedCustomer = service.updateCustomer(id, customer);

    if (!updatedCustomer) {
      response.status(404).json({
        success: false,
        message: "Customer not found",
      });
      return;
    }

    response.status(200).json({
      success: true,
      message: "Customer updated successfully",
      data: updatedCustomer,
    });
  }

  delete(request: Request, response: Response) {
    const id = Number(request.params.id);
    const deleted = service.deleteCustomer(id);

    if (!deleted) {
      response.status(404).json({
        success: false,
        message: "Customer not found",
      });
      return;
    }

    response.status(200).json({
      success: true,
      message: "Customer deleted successfully",
    });
  }
}
