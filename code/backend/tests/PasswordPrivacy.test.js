// TC-SEC-01 (SEC-001): keep password data private.
// Real routes, real bcryptjs and an in-memory MongoDB. Nothing about the
// password path is mocked, and the security logger is read through console.
process.env.JWT_SECRET = "test-secret";
process.env.NODE_ENV = "test";

const request = require("supertest");
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { MongoMemoryServer } = require("mongodb-memory-server");

const User = require("../models/User");
const authRoutes = require("../routes/auth");
const profileRoutes = require("../routes/profile");

const app = express();
app.use(express.json());
app.use("/", authRoutes);
app.use("/api/profile", profileRoutes);

const PLAIN = "CorrectHorse99";
const WRONG = "WrongPassword!77";

let mongod;
let consoleSpies = [];

beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    await User.init();
}, 120000);

afterAll(async () => {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
});

beforeEach(async () => {
    await User.deleteMany({});
    consoleSpies = ["log", "info", "warn", "error"].map((method) =>
        jest.spyOn(console, method).mockImplementation(() => {})
    );
});

afterEach(() => {
    jest.restoreAllMocks();
});

const capturedLogs = () => JSON.stringify(consoleSpies.flatMap((spy) => spy.mock.calls));

const registerAlice = async () => {
    const res = await request(app)
        .post("/register")
        .send({ username: "alice", email: "alice@example.com", password: PLAIN });
    const stored = await User.collection.findOne({ username: "alice" });
    return { res, token: res.body.token, hash: stored.password };
};

describe("persisted data (TC-SEC-01)", () => {
    test("only the bcrypt hash is persisted", async () => {
        const { hash } = await registerAlice();
        const raw = await User.collection.findOne({ username: "alice" });

        expect(hash).toMatch(/^\$2[aby]\$12\$/);
        expect(await bcrypt.compare(PLAIN, hash)).toBe(true);
        expect(JSON.stringify(raw)).not.toContain(PLAIN);
    });
});

describe("ordinary Mongoose queries (TC-SEC-01)", () => {
    test("find, findOne, findById and lean exclude the password by default", async () => {
        await registerAlice();

        const one = await User.findOne({ username: "alice" });
        const many = await User.find({});
        const byId = await User.findById(one._id);
        const lean = await User.findOne({ username: "alice" }).lean();

        expect(one.password).toBeUndefined();
        expect(many[0].password).toBeUndefined();
        expect(byId.password).toBeUndefined();
        expect(lean.password).toBeUndefined();
        expect(one.toObject()).not.toHaveProperty("password");
        expect(JSON.parse(JSON.stringify(one))).not.toHaveProperty("password");
    });

    test("the hash is only returned when a query explicitly opts in", async () => {
        const { hash } = await registerAlice();

        const withPassword = await User.findOne({ username: "alice" }).select("+password");

        expect(withPassword.password).toBe(hash);
    });
});

describe("API responses (TC-SEC-01)", () => {
    test("registration, login, profile and error responses never contain a password or hash", async () => {
        const { res: registerRes, token, hash } = await registerAlice();
        const auth = { Authorization: `Bearer ${token}` };

        const responses = {
            register: registerRes,
            login: await request(app).post("/login").send({ identifier: "alice", password: PLAIN }),
            failedLogin: await request(app).post("/login").send({ identifier: "alice", password: WRONG }),
            unknownLogin: await request(app).post("/login").send({ identifier: "ghost", password: WRONG }),
            duplicateRegister: await request(app)
                .post("/register")
                .send({ username: "alice", email: "alice@example.com", password: PLAIN }),
            myProfile: await request(app).get("/api/profile/me").set(auth),
            publicProfile: await request(app).get("/api/profile/alice").set(auth),
            profileUpdate: await request(app).put("/api/profile/me").set(auth).send({ bio: "hello" })
        };

        // sanity: these really are the flows we meant to exercise
        expect(responses.register.status).toBe(201);
        expect(responses.login.status).toBe(200);
        expect(responses.failedLogin.status).toBe(401);
        expect(responses.duplicateRegister.status).toBe(409);
        expect(responses.myProfile.status).toBe(200);
        expect(responses.publicProfile.status).toBe(200);
        expect(responses.profileUpdate.status).toBe(200);

        const leaks = Object.entries(responses)
            .filter(([, res]) => {
                const body = JSON.stringify(res.body);
                return body.includes(PLAIN) || body.includes(WRONG) || body.includes(hash) || /"password"/i.test(body);
            })
            .map(([name]) => name);

        expect(leaks).toEqual([]);
    });
});

describe("security log entries (TC-SEC-01)", () => {
    test("log output never contains a plaintext password or a hash", async () => {
        const { hash } = await registerAlice();

        await request(app).post("/login").send({ identifier: "alice", password: WRONG });
        await request(app).post("/login").send({ identifier: "ghost", password: WRONG });
        await request(app).post("/login").send({ identifier: "alice", password: PLAIN });

        const logs = capturedLogs();

        expect(logs).toContain("LOGIN_FAILED"); // proves the logger really ran
        expect(logs).not.toContain(PLAIN);
        expect(logs).not.toContain(WRONG);
        expect(logs).not.toContain(hash);
    });
});