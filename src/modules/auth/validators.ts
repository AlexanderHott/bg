import * as v from "valibot";

export const UsernameValidator = v.pipe(
  v.string("username must be a string"),
  v.minLength(3, "username must have at least 3 characters"),
  v.maxLength(32, "username cannot have more than 32 characters"),
);
export const PasswordValidator = v.pipe(
  v.string("password must be a string"),
  v.minLength(8, "password must have at least 8 characters"),
  v.maxLength(64, "password cannot have more than 64 characters"),
);
