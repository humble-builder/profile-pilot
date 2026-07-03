"use client";

import { signIn, signOut, useSession } from "next-auth/react";
import { LogIn, LogOut } from "lucide-react";

export default function AuthButton() {
    const { data: session, status } = useSession();
    const label = session?.user?.name ?? "Guest User";
    const labelSplit = label.split(" ");
    const initials = `${labelSplit[0][0]}${(labelSplit[1]?.[0]) ?? ""}`.toUpperCase();

    if (status === "loading") {
        return (
            <span
                className="flex h-10 w-10 items-center justify-center"
                title="Checking sign-in"
            >
                <span
                    className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900"
                />
            </span>
        );
    }

    if (!session?.user) {
        return (
            <button
                className="flex h-10 w-10 items-center justify-center rounded bg-green-600 text-white transition hover:bg-green-300 active:scale-90"
                onClick={() => signIn("google")}
                type="button"
                title="Sign In"
            >
                <LogIn size={18} />
            </button>
        );
    }

    return (
        <div className="flex items-center gap-2 text-sm">
            <span
                className="flex h-9 w-9 items-center justify-center rounded-full bg-green-600 text-xs font-semibold text-white"
                title={session.user.email ?? label}
            >
                {initials}
            </span>
            <button
                className="flex h-10 w-10 items-center justify-center rounded border border-red-300 text-red-700 transition hover:border-red-400 hover:bg-gray-100 hover:text-red-900 active:scale-90"
                onClick={() => signOut()}
                type="button"
                title="Sign out"
            >
                <LogOut size={18} />
            </button>
        </div>
    );
}
