export class HttpError extends Error {
  constructor(status, code, message, fields = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}
