import { useState, useId, useRef, type FormEvent } from "react";
import { z } from "zod";
import { useAuth } from "./AuthContext";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000/api";

// ── Client-side schema (mirrors server) ────────────────────────────────────
const itemSchema = z.object({
  name:           z.string().trim().min(1, "Name is required").max(120),
  qty:            z.number().int().min(1).max(100),
  // unit price in whole cents — avoids floating-point money on the wire
  unitPriceCents: z.number().int().min(1, "Price must be > 0"),
});

const orderSchema = z.object({
  customerName:  z.string().trim().min(2, "At least 2 characters").max(120),
  customerEmail: z.string().trim().email("Valid email required").max(254),
  items:         z.array(itemSchema).min(1).max(5),
});

type ItemDraft = {
  name:       string;
  qtyStr:     string;   // kept as string so the input is editable freely
  priceStr:   string;   // price in dollars (e.g. "25.00"), converted to cents on submit
};

function emptyItem(): ItemDraft {
  return { name: "", qtyStr: "1", priceStr: "" };
}

// Use a module-level counter to generate unique idempotency keys.
// Reset when the form resets so a fresh form always gets a fresh key.
let formKey = crypto.randomUUID();

type Props = {
  /** Called after a successful create so the parent can refresh the list. */
  onCreated?: () => void;
};

export function CreateOrderForm({ onCreated }: Props) {
  const { authHeader } = useAuth();
  const formId = useId();

  const [customerName,  setCustomerName]  = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [items, setItems]                 = useState<ItemDraft[]>([emptyItem()]);
  const [errors, setErrors]               = useState<string[]>([]);
  const [serverError, setServerError]     = useState<string | null>(null);
  const [loading, setLoading]             = useState(false);
  const [success, setSuccess]             = useState<string | null>(null);

  // The idempotency key is stable for this form instance.
  // It resets only when the form is explicitly cleared (handleReset).
  const idempotencyKey = useRef<string>(formKey);

  // Auto-compute total for display only (server recomputes authoritatively).
  const totalCents = items.reduce((sum, item) => {
    const qty   = parseInt(item.qtyStr,  10) || 0;
    const price = parseFloat(item.priceStr)  || 0;
    return sum + qty * Math.round(price * 100);
  }, 0);

  function updateItem(index: number, patch: Partial<ItemDraft>) {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }

  function addItem() {
    if (items.length < 5) setItems((prev) => [...prev, emptyItem()]);
  }

  function removeItem(index: number) {
    if (items.length > 1) setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function handleReset() {
    setCustomerName("");
    setCustomerEmail("");
    setItems([emptyItem()]);
    setErrors([]);
    setServerError(null);
    setSuccess(null);
    // Generate a new idempotency key for the fresh form.
    formKey = crypto.randomUUID();
    idempotencyKey.current = formKey;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrors([]);
    setServerError(null);
    setSuccess(null);

    // ── Client-side validation ─────────────────────────────────────────────
    const parsed = orderSchema.safeParse({
      customerName,
      customerEmail,
      items: items.map((item) => ({
        name:           item.name,
        qty:            parseInt(item.qtyStr, 10),
        // Convert dollars → cents (integer) for the server
        unitPriceCents: Math.round(parseFloat(item.priceStr) * 100),
      })),
    });

    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => i.message));
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
          ...authHeader(),
        },
        body: JSON.stringify(parsed.data),
      });

      const body = await res.json();

      if (!res.ok) {
        setServerError(body?.error?.message ?? `Error ${res.status}`);
        return;
      }

      const order = body.data;
      setSuccess(`Order ${order.orderNumber} created — total $${Number(order.totalAmount).toFixed(2)}`);
      onCreated?.();
      // Reset form + generate a new key for the next order.
      handleReset();
    } catch {
      setServerError("Network error — is the API running?");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      id={`${formId}-form`}
      onSubmit={handleSubmit}
      className="create-order-form"
      noValidate
    >
      <h2 className="form-title">New Order</h2>

      {/* ── Customer fields ─────────────────────────────────────────────── */}
      <div className="form-row">
        <label className="field-label">
          Customer name
          <input
            className="field-input"
            type="text"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Jane Smith"
            disabled={loading}
            required
          />
        </label>

        <label className="field-label">
          Customer email
          <input
            className="field-input"
            type="email"
            value={customerEmail}
            onChange={(e) => setCustomerEmail(e.target.value)}
            placeholder="jane@example.com"
            disabled={loading}
            required
          />
        </label>
      </div>

      {/* ── Line items ──────────────────────────────────────────────────── */}
      <fieldset className="items-fieldset">
        <legend className="items-legend">
          Line items <span className="items-count">({items.length}/5)</span>
        </legend>

        {items.map((item, index) => (
          <div key={index} className="item-row">
            <label className="field-label item-name-field">
              {index === 0 ? "Product name" : ""}
              <input
                className="field-input"
                type="text"
                value={item.name}
                onChange={(e) => updateItem(index, { name: e.target.value })}
                placeholder="Product name"
                disabled={loading}
                required
              />
            </label>

            <label className="field-label item-qty-field">
              {index === 0 ? "Qty" : ""}
              <input
                className="field-input"
                type="number"
                min={1}
                max={100}
                value={item.qtyStr}
                onChange={(e) => updateItem(index, { qtyStr: e.target.value })}
                disabled={loading}
              />
            </label>

            <label className="field-label item-price-field">
              {index === 0 ? "Unit price ($)" : ""}
              <input
                className="field-input"
                type="number"
                min="0.01"
                step="0.01"
                value={item.priceStr}
                onChange={(e) => updateItem(index, { priceStr: e.target.value })}
                placeholder="0.00"
                disabled={loading}
              />
            </label>

            <button
              type="button"
              className="remove-item-button"
              onClick={() => removeItem(index)}
              disabled={items.length === 1 || loading}
              aria-label={`Remove item ${index + 1}`}
              style={{ marginTop: index === 0 ? "22px" : "0" }}
            >
              ✕
            </button>
          </div>
        ))}

        {items.length < 5 && (
          <button
            type="button"
            className="add-item-button"
            onClick={addItem}
            disabled={loading}
          >
            + Add item
          </button>
        )}
      </fieldset>

      {/* ── Computed total ──────────────────────────────────────────────── */}
      <div className="order-total">
        Estimated total:{" "}
        <strong>
          {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
            totalCents / 100,
          )}
        </strong>
        <span className="total-note">(server recomputes)</span>
      </div>

      {/* ── Errors ─────────────────────────────────────────────────────── */}
      {errors.length > 0 && (
        <ul className="form-errors" role="alert">
          {errors.map((msg, i) => (
            <li key={i}>{msg}</li>
          ))}
        </ul>
      )}

      {serverError && (
        <div className="login-error" role="alert">
          {serverError}
        </div>
      )}

      {success && (
        <div className="form-success" role="status">
          ✓ {success}
        </div>
      )}

      {/* ── Actions ────────────────────────────────────────────────────── */}
      <div className="form-actions">
        <button
          type="button"
          className="reset-button"
          onClick={handleReset}
          disabled={loading}
        >
          Clear
        </button>

        {/* Button stays disabled while in-flight — only UX, not the
            idempotency guard. The key still prevents server-side duplicates. */}
        <button
          id="create-order-submit"
          type="submit"
          className="login-button"
          disabled={loading}
        >
          {loading ? "Placing order…" : "Place order"}
        </button>
      </div>
    </form>
  );
}
