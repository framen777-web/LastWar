import { MenuButton } from "@/components/MenuButton";

export default function Home() {
  return (
    <div className="flex flex-col gap-3 max-w-sm mx-auto">
      <MenuButton href="/new-information" label="New Information" description="Import screenshots and view stats" />
      <MenuButton href="/reports" label="Weekly Reports" description="Records, leaderboards and growth for a given week" />
      <MenuButton href="/setup" label="Setup" description="Categories and configuration" />
    </div>
  );
}
