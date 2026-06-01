import type { FC } from "@hono/hono/jsx";

const SignInPage: FC<{ error?: string }> = (props) => (
  <div>
    <h1>Sign In</h1>
    {props.error && <p style="color:red">{props.error}</p>}
    <form method="post" action="/auth/signin">
      <label>
        Username
        <input type="text" name="username" required />
      </label>
      <br />
      <label>
        Password
        <input type="password" name="password" required />
      </label>
      <br />
      <button type="submit">Sign In</button>
    </form>
    <p>
      <a href="/auth/register">Create an account</a>
    </p>
  </div>
);

const RegisterPage: FC<{ error?: string }> = (props) => (
  <div>
    <h1>Register</h1>
    {props.error && <p style="color:red">{props.error}</p>}
    <form method="post" action="/auth/register">
      <label>
        Username
        <input type="text" name="username" required />
      </label>
      <br />
      <label>
        Display Name
        <input type="text" name="display_name" required />
      </label>
      <br />
      <label>
        Password
        <input type="password" name="password" required />
      </label>
      <br />
      <button type="submit">Register</button>
    </form>
    <p>
      <a href="/auth/signin">Already have an account?</a>
    </p>
  </div>
);

export { SignInPage, RegisterPage };
