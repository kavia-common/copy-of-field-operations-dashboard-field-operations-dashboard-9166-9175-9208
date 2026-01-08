import { render, screen } from "@testing-library/react";
import React from "react";
import LoginPage from "./pages/LoginPage";

test("renders login screen", () => {
  render(<LoginPage onLoggedIn={() => {}} />);
  expect(screen.getByText(/Select a demo account/i)).toBeInTheDocument();
});
