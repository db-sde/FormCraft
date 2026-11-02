/**
 * Loads every connector's actions into the worker (each module registers
 * its own). Import this wherever jobs are dispatched.
 */
import "@/domains/bookings/google-calendar";
import "@/domains/connectors/providers";
