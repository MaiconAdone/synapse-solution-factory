export function isAddressInUseError(error: NodeJS.ErrnoException): boolean {
  return error.code === "EADDRINUSE";
}
