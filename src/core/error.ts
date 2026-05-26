export class BlennyError extends Error {
  constructor(
    public type: string,
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = "BlennyError";
  }

  static notFound(message = "Not Found"): BlennyError {
    return new BlennyError("not_found", message, 404);
  }

  static unauthorized(message = "Unauthorized"): BlennyError {
    return new BlennyError("unauthorized", message, 401);
  }

  static internal(message = "Internal Server Error"): BlennyError {
    return new BlennyError("internal", message, 500);
  }

  toJSON(): { error: { type: string; message: string } } {
    return { error: { type: this.type, message: this.message } };
  }
}
