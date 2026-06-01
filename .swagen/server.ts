interface Pet {
  id: number;
  name: string;
  category?: { id: number; name: string };
  photoUrls: string[];
  tags?: { id: number; name: string }[];
  status: "available" | "pending" | "sold";
}

interface User {
  id: number;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  phone: string;
  userStatus: number;
}

interface Order {
  id: number;
  petId: number;
  quantity: number;
  shipDate: string;
  status: "placed" | "approved" | "delivered";
  complete: boolean;
}

const PORT = parseInt(process.env["MOCK_SERVER_PORT"] ?? "3000", 10);

const pets = new Map<number, Pet>();
const users = new Map<string, User>();
const orders = new Map<number, Order>();

let nextPetId = 100;
let nextOrderId = 1000;

pets.set(1, {
  id: 1,
  name: "Doggo",
  photoUrls: ["https://example.com/dog.jpg"],
  tags: [{ id: 1, name: "friendly" }],
  status: "available",
});
pets.set(2, { id: 2, name: "Kitty", photoUrls: [], status: "pending" });
pets.set(3, { id: 3, name: "Birb", photoUrls: [], status: "sold" });

users.set("testuser", {
  id: 1,
  username: "testuser",
  firstName: "Test",
  lastName: "User",
  email: "test@example.com",
  password: "pass123",
  phone: "555-0000",
  userStatus: 1,
});

// Pre-seeded so GET/DELETE /store/order/1 (hardcoded by codegen) works
orders.set(1, {
  id: 1,
  petId: 1,
  quantity: 1,
  shipDate: new Date().toISOString(),
  status: "placed",
  complete: false,
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseBody(req: Request): Promise<unknown> {
  return req.json().catch((e) => {
    process.stderr.write(`[mock-server] JSON parse error: ${e.message}\n`);
    return null;
  });
}

const server = Bun.serve({
  port: PORT,

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const method = req.method;
    const path = url.pathname;

    // ── Pet endpoints ────────────────────────────────────────────────

    if (method === "POST" && path === "/pet") {
      const body = (await parseBody(req)) as Partial<Pet>;
      if (!body?.name || !body?.photoUrls) {
        return json({ message: "name and photoUrls are required", code: 405 }, 405);
      }
      const id = nextPetId++;
      const pet: Pet = {
        id,
        name: body.name,
        photoUrls: body.photoUrls,
        category: body.category ?? { id: 0, name: "unknown" },
        tags: body.tags ?? [],
        status: body.status ?? "available",
      };
      pets.set(id, pet);
      return json(pet, 200);
    }

    if (method === "PUT" && path === "/pet") {
      const body = (await parseBody(req)) as Partial<Pet>;
      if (!body?.id) return json({ message: "Pet ID is required", code: 400 }, 400);
      const existing = pets.get(body.id);
      if (!existing) return json({ message: "Pet not found", code: 404 }, 404);
      const updated: Pet = { ...existing, ...body };
      pets.set(updated.id, updated);
      return json(updated, 200);
    }

    if (method === "GET" && path === "/pet/findByStatus") {
      const statuses = (url.searchParams.get("status") ?? "available").split(",");
      const result: Pet[] = [];
      for (const pet of pets.values()) {
        if (statuses.includes(pet.status)) result.push(pet);
      }
      return json(result, 200);
    }

    if (method === "GET" && path === "/pet/findByTags") {
      const tags = (url.searchParams.get("tags") ?? "").split(",").filter(Boolean);
      const result: Pet[] = [];
      for (const pet of pets.values()) {
        if (pet.tags?.some((t) => tags.includes(t.name))) result.push(pet);
      }
      return json(result, 200);
    }

    const petMatch = path.match(/^\/pet\/(\d+)$/);
    if (petMatch) {
      const petId = parseInt(petMatch[1]!, 10);

      if (method === "GET") {
        const pet = pets.get(petId);
        if (!pet) return json({ message: "Pet not found", code: 404 }, 404);
        return json(pet, 200);
      }

      if (method === "POST") {
        const body = await parseBody(req) as Record<string, unknown> | null ?? {};
        const existing = pets.get(petId);
        if (!existing) return json({ message: "Pet not found", code: 404 }, 404);
        const updated: Pet = { ...existing, ...body, id: petId };
        if (body.name) updated.name = String(body.name);
        pets.set(petId, updated);
        return json(updated, 200);
      }

      if (method === "DELETE") {
        const deleted = pets.delete(petId);
        if (!deleted) return json({ message: "Pet not found", code: 404 }, 404);
        return json({ message: "Pet deleted" }, 200);
      }
    }

    const uploadMatch = path.match(/^\/pet\/(\d+)\/uploadImage$/);
    if (uploadMatch && method === "POST") {
      return json({ code: 200, type: "unknown", message: "file uploaded" }, 200);
    }

    // ── Store endpoints ──────────────────────────────────────────────

    if (method === "GET" && path === "/store/inventory") {
      const inventory: Record<string, number> = {};
      for (const pet of pets.values()) {
        inventory[pet.status] = (inventory[pet.status] ?? 0) + 1;
      }
      return json(inventory, 200);
    }

    if (method === "POST" && path === "/store/order") {
      const body = (await parseBody(req)) as Partial<Order>;
      const id = nextOrderId++;
      const order: Order = {
        id,
        petId: body.petId ?? 1,
        quantity: body.quantity ?? 1,
        shipDate: new Date().toISOString(),
        status: body.status ?? "placed",
        complete: body.complete ?? false,
      };
      orders.set(id, order);
      return json(order, 200);
    }

    const orderMatch = path.match(/^\/store\/order\/(\d+)$/);
    if (orderMatch) {
      const orderId = parseInt(orderMatch[1]!, 10);

      if (method === "GET") {
        const order = orders.get(orderId);
        if (!order) return json({ message: "Order not found", code: 404 }, 404);
        return json(order, 200);
      }

      if (method === "DELETE") {
        const deleted = orders.delete(orderId);
        if (!deleted) return json({ message: "Order not found", code: 404 }, 404);
        return json({ message: "Order deleted" }, 200);
      }
    }

    // ── User endpoints ───────────────────────────────────────────────

    if (method === "POST" && path === "/user") {
      const body = (await parseBody(req)) as Partial<User>;
      if (!body?.username) return json({ message: "username is required", code: 400 }, 400);
      const user: User = {
        id: body.id ?? users.size + 1,
        username: body.username,
        firstName: body.firstName ?? "",
        lastName: body.lastName ?? "",
        email: body.email ?? "",
        password: body.password ?? "",
        phone: body.phone ?? "",
        userStatus: body.userStatus ?? 0,
      };
      users.set(user.username, user);
      return json({ code: 200, type: "unknown", message: String(user.id) }, 200);
    }

    if (
      method === "POST" &&
      (path === "/user/createWithList" || path === "/user/createWithArray")
    ) {
      const body = (await parseBody(req)) as Partial<User>[];
      if (!Array.isArray(body) || body.length === 0) {
        return json({ code: 200, type: "unknown", message: "ok" }, 200);
      }
      for (const u of body) {
        if (u.username) {
          users.set(u.username, {
            id: u.id ?? users.size + 1,
            username: u.username,
            firstName: u.firstName ?? "",
            lastName: u.lastName ?? "",
            email: u.email ?? "",
            password: u.password ?? "",
            phone: u.phone ?? "",
            userStatus: u.userStatus ?? 0,
          });
        }
      }
      return json({ code: 200, type: "unknown", message: "ok" }, 200);
    }

    if (method === "GET" && path === "/user/login") {
      return json({ code: 200, type: "unknown", message: Date.now().toString() }, 200);
    }

    if (method === "GET" && path === "/user/logout") {
      return json({ code: 200, type: "unknown", message: "ok" }, 200);
    }

    const userMatch = path.match(/^\/user\/([^/]+)$/);
    if (userMatch) {
      const username = decodeURIComponent(userMatch[1]!);

      if (method === "GET") {
        const user = users.get(username);
        if (!user) return json({ message: "User not found", code: 404 }, 404);
        return json(user, 200);
      }

      if (method === "PUT") {
        const body = (await parseBody(req)) as Partial<User>;
        const existing = users.get(username);
        if (!existing) return json({ message: "User not found", code: 404 }, 404);
        const updated: User = { ...existing, ...body };
        users.set(username, updated);
        return json({ code: 200, type: "unknown", message: String(updated.id) }, 200);
      }

      if (method === "DELETE") {
        const deleted = users.delete(username);
        if (!deleted) return json({ message: "User not found", code: 404 }, 404);
        return json({ message: "User deleted" }, 200);
      }
    }

    return json({ message: "Not Found", code: 404 }, 404);
  },
});

process.stderr.write(`Mock Petstore server running on http://localhost:${PORT}\n`);

export default server;
