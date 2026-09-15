"use client";

import { useEffect, useState, useCallback } from "react";

type Patient = {
  patient_id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  sex: string;
  phone_number: string;
  email?: string;
  address_line_1: string;
  address_line_2?: string;
  city: string;
  state: string;
  zip_code: string;
  insurance_provider?: string;
  preferred_language?: string;
  created_at: number;
  updated_at: number;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

function formatPhone(p: string) {
  return p.length === 10 ? `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}` : p;
}

export default function Dashboard() {
  const [patients, setPatients] = useState<Patient[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    if (!API_BASE) {
      setError("NEXT_PUBLIC_API_BASE_URL is not set — see README.");
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/patients`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? "failed to load patients");
      setPatients(json.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load patients");
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  const filtered = (patients ?? []).filter((p) => {
    const q = search.toLowerCase();
    return (
      p.first_name.toLowerCase().includes(q) ||
      p.last_name.toLowerCase().includes(q) ||
      p.phone_number.includes(q)
    );
  });

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold">Patient Registry</h1>
            <p className="text-slate-400 text-sm">
              Live view of patients registered via the voice agent or REST API.
            </p>
          </div>
          <button
            onClick={load}
            className="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-sm"
          >
            Refresh
          </button>
        </div>

        <input
          placeholder="Search by name or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full mb-4 px-3 py-2 rounded-md bg-slate-900 border border-slate-800 text-sm outline-none focus:border-slate-600"
        />

        {error && (
          <div className="mb-4 px-3 py-2 rounded-md bg-red-950 border border-red-900 text-red-300 text-sm">
            {error}
          </div>
        )}

        {!patients && !error && <p className="text-slate-500">Loading...</p>}

        {patients && (
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-slate-400">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Name</th>
                  <th className="text-left px-3 py-2 font-medium">DOB</th>
                  <th className="text-left px-3 py-2 font-medium">Phone</th>
                  <th className="text-left px-3 py-2 font-medium">Address</th>
                  <th className="text-left px-3 py-2 font-medium">Insurance</th>
                  <th className="text-left px-3 py-2 font-medium">Registered</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                      No patients yet. Call the agent to register one.
                    </td>
                  </tr>
                )}
                {filtered.map((p) => (
                  <tr key={p.patient_id} className="border-t border-slate-800 hover:bg-slate-900/50">
                    <td className="px-3 py-2">
                      {p.first_name} {p.last_name}
                    </td>
                    <td className="px-3 py-2 text-slate-400">{p.date_of_birth}</td>
                    <td className="px-3 py-2 text-slate-400">{formatPhone(p.phone_number)}</td>
                    <td className="px-3 py-2 text-slate-400">
                      {p.address_line_1}
                      {p.address_line_2 ? `, ${p.address_line_2}` : ""}, {p.city}, {p.state}{" "}
                      {p.zip_code}
                    </td>
                    <td className="px-3 py-2 text-slate-400">{p.insurance_provider ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-500">
                      {new Date(p.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
