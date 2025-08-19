// app/layout.js
export const metadata = { title: "The Fulfilled Trip Planner" };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, Arial" }}>
        {children}
      </body>
    </html>
  );
}

