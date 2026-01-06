import { render, screen } from "@testing-library/react";
import App from "./App";

// Avoid importing react-leaflet (ESM) during Jest runs by mocking the dashboard page,
// since the test only validates the unauthenticated flow renders the login screen.
jest.mock("./pages/DashboardPage", () => () => null);

test("renders login screen when not authenticated", () => {
  render(<App />);
  expect(screen.getByText(/Select a demo account/i)).toBeInTheDocument();
});
