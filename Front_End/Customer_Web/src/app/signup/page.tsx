import SignupForm from "./SignupForm";

export const metadata = {
  title: "Đăng ký — The BHA",
};

/**
 * CUST-WEB-001-CP03: the template's signup layout, connected to the Customer API. Registering creates an
 * account only (no session). Social signup, terms checkboxes and email verification do not exist and are
 * not shown.
 */
export default function PageSignUp() {
  return (
    <div className={`nc-PageSignUp`}>
      <div className="container mb-24 lg:mb-32">
        <SignupForm />
      </div>
    </div>
  );
}
