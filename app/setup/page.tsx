import { MenuButton } from "@/components/MenuButton";

export default function SetupPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Setup</h1>
      <div className="flex flex-col gap-3 max-w-sm">
        <MenuButton href="/categories" label="Categories" description="What gets imported and how it's stored" />
        <MenuButton href="/settings" label="Settings" description="WhatsApp number and other app preferences" />
      </div>
    </div>
  );
}
