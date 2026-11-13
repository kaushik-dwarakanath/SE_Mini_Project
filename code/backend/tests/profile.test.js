process.env.JWT_SECRET = "profile-tests-only";
process.env.NODE_ENV = "test";
jest.mock("../models/User");
jest.mock("../utils/logger");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const authRoutes = require("../routes/auth");
const app = express();
app.use(express.json(), authRoutes);
const token = jwt.sign({ userId: "account-a" }, process.env.JWT_SECRET);
const profile = (value) => {
  const lean = jest.fn().mockResolvedValue(value);
  const select = jest.fn().mockReturnValue({ lean });
  User.findById.mockReturnValue({ select });
  return { select, lean };
};
beforeEach(() => jest.clearAllMocks());
test("returns only the signed-in account's username/email, ignoring a requested user ID", async () => {
  const { select } = profile({ _id: "account-a", username: "Alice", email: "alice@example.com", password: "SECRET_HASH" });
  const res = await request(app).get("/api/auth/me?userId=account-b").set("Authorization", `Bearer ${token}`);
  expect(res.status).toBe(200);
  expect(User.findById).toHaveBeenCalledWith("account-a");
  expect(select).toHaveBeenCalledWith("username email");
  expect(res.body).toEqual({ user: { username: "Alice", email: "alice@example.com" } });
});
test.each([
  undefined, "invalid", jwt.sign({ userId: "account-a" }, "wrong-secret"),
  jwt.sign({ userId: "account-a" }, process.env.JWT_SECRET, { expiresIn: -1 }),
])("rejects missing, invalid or expired token (%s)", async (value) => {
  let req = request(app).get("/api/auth/me");
  if (value) req = req.set("Authorization", `Bearer ${value}`);
  expect((await req).status).toBe(401);
  expect(User.findById).not.toHaveBeenCalled();
});
test("a deleted account returns 401", async () => {
  profile(null);
  expect((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`)).status).toBe(401);
});
test("database failure returns a clear error without leaking internals", async () => {
  User.findById.mockImplementation(() => { throw new Error("private database error"); });
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "Could not retrieve user profile" });
  } finally { spy.mockRestore(); }
});
