import * as v from "valibot";

export const UsernameValidator = v.pipe(
  v.string("Username must be a string"),
  v.minLength(3, "Username must have at least 3 characters"),
  v.maxLength(32, "Username cannot have more than 32 characters"),
);
export const PasswordValidator = v.pipe(
  v.string("Password must be a string"),
  v.minLength(8, "Password must have at least 8 characters"),
  v.maxLength(64, "Password cannot have more than 64 characters"),
);
