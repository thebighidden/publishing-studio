/* Dev-only migration harness. See ui-check.html.
 *
 * Left column: legacy markup using styles.css classes, which must look exactly
 * as it did before Tailwind was added. Right column: the same controls built
 * from shadcn primitives inside a `.ui` surface. If the `:where(:not(.ui, .ui *))`
 * guards in styles.css or the scoped base in index.css ever regress, one of the
 * two columns breaks here first.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./styles.css";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function ThemeToggle() {
  const [theme, setTheme] = React.useState(
    () => document.documentElement.dataset.theme || "light"
  );
  React.useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return (
    <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
      Toggle theme (now: {theme})
    </button>
  );
}

function Legacy() {
  return (
    <div className="panel">
      <h3>Legacy — styles.css</h3>
      <div className="row">
        <button>Default</button>
        <button className="primary">Primary</button>
        <button className="danger">Danger</button>
        <button className="ghost">Ghost</button>
        <button className="small">Small</button>
        <button disabled>Disabled</button>
      </div>
      <div className="field">
        <label>Caption</label>
        <input placeholder="Legacy input" />
      </div>
      <div className="field">
        <label>Body</label>
        <textarea placeholder="Legacy textarea" />
      </div>
      <div className="field">
        <label>Placement</label>
        <select>
          <option>feed</option>
          <option>reel</option>
        </select>
      </div>
      <div className="row">
        <span className="tag ok">confirmed</span>
        <span className="tag bad">failed</span>
        <span className="tag">uncertain</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Run</th>
            <th>Outcome</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>ca737c0f</td>
            <td>confirmed</td>
          </tr>
          <tr>
            <td>9f21ab40</td>
            <td>uncertain</td>
          </tr>
        </tbody>
      </table>
      <p>
        Paragraph with an <a href="#none">inline link</a> and <code>code</code>.
      </p>
      <div className="grid two">
        <div className="panel soft">grid cell</div>
        <div className="panel soft">grid cell</div>
      </div>
    </div>
  );
}

function Modern() {
  return (
    <div className="ui">
      <Card>
        <CardHeader>
          <CardTitle>Design system — shadcn/ui</CardTitle>
          <CardDescription>
            Same controls, inside a <code>.ui</code> surface.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-2">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="link">Link</Button>
            <Button size="sm">Small</Button>
            <Button disabled>Disabled</Button>
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="caption">Caption</Label>
              <Input id="caption" placeholder="shadcn input" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="token">Distinctive token</Label>
              <Input id="token" defaultValue="k7f3qz" />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="body">Body</Label>
            <Textarea id="body" placeholder="shadcn textarea" />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge>confirmed</Badge>
            <Badge variant="secondary">queued</Badge>
            <Badge variant="destructive">failed</Badge>
            <Badge variant="outline">uncertain</Badge>
          </div>

          <div className="flex items-center gap-3">
            <Switch id="pause" />
            <Label htmlFor="pause">Pause publishing</Label>
          </div>

          <Progress value={62} />

          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>

          <Tabs defaultValue="plan">
            <TabsList>
              <TabsTrigger value="plan">Plan</TabsTrigger>
              <TabsTrigger value="content">Content</TabsTrigger>
              <TabsTrigger value="evidence">Evidence</TabsTrigger>
            </TabsList>
            <TabsContent value="plan" className="pt-3 text-sm text-muted-foreground">
              Gate 6A approves the plan.
            </TabsContent>
            <TabsContent value="content" className="pt-3 text-sm text-muted-foreground">
              Gate 6B approves the content.
            </TabsContent>
            <TabsContent value="evidence" className="pt-3 text-sm text-muted-foreground">
              Screenshots and the per-step log.
            </TabsContent>
          </Tabs>

          <div className="rounded-lg border bg-muted p-4 text-sm">
            <p className="font-medium text-foreground">bg-muted / border / rounded-lg</p>
            <p className="text-muted-foreground">
              If this block is dark grey or square-cornered, a legacy token is
              winning.
            </p>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 text-left font-medium">Run</th>
                <th className="py-2 text-left font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b">
                <td className="py-2">ca737c0f</td>
                <td className="py-2">confirmed</td>
              </tr>
              <tr>
                <td className="py-2">9f21ab40</td>
                <td className="py-2">uncertain</td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <div style={{ padding: 20 }}>
      <div className="row" style={{ marginBottom: 16 }}>
        <ThemeToggle />
        <span className="small muted">
          Left column must be pixel-identical to pre-Tailwind.
        </span>
      </div>
      <div className="grid two" style={{ alignItems: "start" }}>
        <Legacy />
        <Modern />
      </div>
    </div>
  </React.StrictMode>
);
