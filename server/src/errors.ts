export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
    public details?: Record<string, string>,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(`${what} not found`, 404);
export const forbidden = () => new AppError("Only the host can do that", 403);
